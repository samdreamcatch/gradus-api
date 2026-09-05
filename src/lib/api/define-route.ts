/**
 * `defineApiRoute` — builds the `server.handlers` object for a TanStack file
 * route under `src/routes/api/v1/**`, per docs/ios/PRD.md §6.2 and §9.4.
 *
 * Pipeline (in order): kill switch → rate limit → auth → JSON parse → input
 * validation → idempotency → handler → output validation → `Cache-Control:
 * no-store` → error mapping.
 *
 * Judgment call: rate limiting needs to key on the caller's user id "when
 * authenticated" (PRD §6.2), but the brief also orders rate-limit strictly
 * before auth. Both are satisfied by performing one lenient auth attempt
 * up front — its result is used only for the rate-limit key — and only
 * surfacing an auth failure afterward, for `auth: "user"` routes, once the
 * rate limit has already been checked. A 429 therefore always wins over a
 * 401, matching the brief's ordering, without a second network round trip
 * to Supabase for the same token.
 */
import { z, type ZodType } from "zod";
import { ApiError, normalizeError, toResponse } from "./errors";
import { authenticateRequest, type ApiContext } from "./auth";
import { withIdempotency } from "./idempotency";
import { checkRateLimit, type RateLimitConfig } from "./rate-limit";
import { registerApiRoute } from "./openapi";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface DefineApiRouteOptions<TInput, TOutput> {
  method: HttpMethod;
  path: string;
  auth: "user" | "public";
  summary?: string;
  /** OpenAPI operation id; defaults to one derived from method and path. */
  operationId?: string;
  input?: ZodType<TInput>;
  output: ZodType<TOutput>;
  /** When true, honors the `Idempotency-Key` header. Requires `auth: "user"`. */
  idempotent?: boolean;
  rateLimit?: RateLimitConfig;
  /**
   * Conditional GET (PRD Appendix A `[etag]`). Returns a validator for the
   * output — see `weakETag` — or null when nothing stable identifies it. The
   * route then sends `ETag` and answers a matching `If-None-Match` with 304.
   */
  etag?: (output: TOutput) => string | null;
  handler: (args: {
    ctx: ApiContext | null;
    input: TInput;
    request: Request;
    /** Dynamic path segments (e.g. `$slug` in the file name) — empty for a static route. */
    params: Record<string, string>;
  }) => Promise<TOutput>;
}

export interface ApiRouteDeps {
  admin: ApiContext["admin"];
  authenticate: (request: Request) => Promise<ApiContext | null>;
}

const defaultDeps: ApiRouteDeps = {
  admin: supabaseAdmin,
  authenticate: authenticateRequest,
};

type RouteHandlers = Partial<
  Record<
    HttpMethod,
    (args: { request: Request; params?: Record<string, string> }) => Promise<Response>
  >
>;

/**
 * A weak validator built from stable parts of a response, e.g. a board's slug
 * and snapshot time. Weak because two snapshots with the same stamp are
 * semantically equal even if serialized differently. Quoted-string safe.
 */
export function weakETag(parts: string[]): string {
  const safe = parts.join(".").replace(/[^\x21\x23-\x7e]/g, "_");
  return `W/"${safe}"`;
}

/** RFC 9110 §13.1.2: any listed validator matches weakly, and `*` matches everything. */
export function ifNoneMatchMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const strip = (v: string) => v.trim().replace(/^W\//, "");
  const wanted = strip(etag);
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || strip(value) === wanted;
  });
}

function getClientIp(request: Request): string | null {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

/**
 * Builds the route handler without touching the OpenAPI registry or the
 * real Supabase clients — used directly by `defineApiRoute` and by tests,
 * which pass an in-memory fake `admin` and a fake `authenticate`.
 */
export function createApiRouteHandler<TInput, TOutput>(
  options: DefineApiRouteOptions<TInput, TOutput>,
  deps: ApiRouteDeps = defaultDeps,
): RouteHandlers {
  const handle = async ({
    request,
    params,
  }: {
    request: Request;
    params?: Record<string, string>;
  }): Promise<Response> => {
    let response: Response;

    try {
      if (process.env.API_V1_ENABLED !== "true") {
        throw ApiError.disabled();
      }

      let ctx: ApiContext | null = null;
      let authError: ApiError | null = null;
      try {
        ctx = await deps.authenticate(request);
      } catch (err) {
        authError = err instanceof ApiError ? err : normalizeError(err);
      }

      if (options.rateLimit) {
        const result = await checkRateLimit(deps.admin, options.rateLimit, {
          route: options.path,
          ip: getClientIp(request),
          userId: ctx?.userId ?? null,
        });
        if (!result.allowed) {
          throw ApiError.rateLimited(result.retryAfterSeconds);
        }
        // Public write routes (sign-in, sign-up, recovery) bypass captcha by
        // design; this limiter is their only abuse control. If it cannot be
        // consulted, refuse rather than run unprotected. Public reads and
        // authenticated routes proceed.
        if (result.degraded && options.auth === "public" && options.method !== "GET") {
          throw ApiError.limiterUnavailable();
        }
      }

      if (options.auth === "user" && !ctx) {
        throw authError ?? ApiError.unauthenticated();
      }

      let rawBody: unknown;
      if (options.input) {
        const text = await request.text();
        if (text) {
          try {
            rawBody = JSON.parse(text);
          } catch {
            throw new ApiError({
              code: "validation_failed",
              status: 400,
              message: "Request body is not valid JSON.",
            });
          }
        }
      }

      let input: TInput = undefined as TInput;
      if (options.input) {
        input = options.input.parse(rawBody);
      }

      const runHandler = async (): Promise<{ status: number; body: unknown }> => {
        const output = await options.handler({ ctx, input, request, params: params ?? {} });
        const parsedOutput = options.output.parse(output);
        return { status: 200, body: parsedOutput };
      };

      let result: { status: number; body: unknown };
      if (options.idempotent) {
        if (!ctx) throw authError ?? ApiError.unauthenticated();
        const key = request.headers.get("idempotency-key");
        result = await withIdempotency(ctx, key, runHandler);
      } else {
        result = await runHandler();
      }

      const etag =
        options.etag && result.status === 200 ? options.etag(result.body as TOutput) : null;
      if (etag && ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
        response = new Response(null, { status: 304, headers: { ETag: etag } });
      } else {
        response = Response.json(result.body, { status: result.status });
        if (etag) response.headers.set("ETag", etag);
      }
    } catch (err) {
      response = toResponse(normalizeError(err));
    }

    response.headers.set("Cache-Control", "no-store");
    return response;
  };

  return { [options.method]: handle };
}

/** Builds route handlers and registers the route in the OpenAPI registry. */
export function defineApiRoute<TInput, TOutput>(
  options: DefineApiRouteOptions<TInput, TOutput>,
): RouteHandlers {
  registerApiRoute({
    method: options.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete",
    path: options.path,
    summary: options.summary ?? options.path,
    operationId: options.operationId,
    auth: options.auth,
    input: options.input,
    output: options.output,
    etag: !!options.etag,
  });

  return createApiRouteHandler(options);
}
