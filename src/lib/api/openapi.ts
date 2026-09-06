/**
 * OpenAPI 3.1 registry and document builder for `/api/v1`, per
 * docs/ios/PRD.md §6.2 and §9.4. Every route registers itself here through
 * `defineApiRoute` (see define-route.ts). `scripts/openapi.ts` imports the
 * route modules (for the registration side effect) and calls
 * `buildOpenApiDocument()` to write `docs/api/openapi.json`.
 */
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z, type ZodType } from "zod";

extendZodWithOpenApi(z);

export const apiRegistry = new OpenAPIRegistry();

apiRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "Supabase access token",
});

const errorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ApiError");

export interface RegisterRouteOptions {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  summary: string;
  auth: "user" | "public";
  input?: ZodType;
  output: ZodType;
  /** Defaults to `deriveOperationId(method, path)`. */
  operationId?: string;
  /** Conditional GET: declares `If-None-Match`, the `ETag` header, and the 304 response. */
  etag?: boolean;
}

/**
 * Stable, unique operation name derived from the method and path, e.g.
 * `POST /api/v1/auth/username/check` → `postAuthUsernameCheck` and
 * `GET /api/v1/boards/{slug}` → `getBoardsBySlug`. Client generators
 * (swift-openapi-generator for gradus-ios) require an `operationId` on
 * every operation and use it as the method name, so once published a
 * derived id is part of the v1 contract: renaming a path is a breaking
 * change, which §6.2 already forbids within v1.
 */
export function deriveOperationId(method: string, path: string): string {
  const capitalize = (segment: string) =>
    segment
      .split(/[-_]/)
      .filter(Boolean)
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join("");
  const parts = path
    .replace(/^\/api\/v1\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith("{") && segment.endsWith("}")
        ? "By" + capitalize(segment.slice(1, -1))
        : capitalize(segment),
    );
  return method.toLowerCase() + parts.join("");
}

/** operationId → "METHOD path" that claimed it; re-registering the same route (dev HMR) is a no-op. */
const registeredOperationIds = new Map<string, string>();

/**
 * Every `{name}` segment of the path becomes a required string path
 * parameter. Generators (swift-openapi-generator) reject a templated path
 * whose parameters are not declared, and file routes receive them as
 * strings, so the string schema is the truth of the transport.
 */
export function pathParamsSchema(
  path: string,
): z.ZodObject<Record<string, z.ZodString>> | undefined {
  const names = [...path.matchAll(/\{([a-zA-Z0-9_-]+)\}/g)].map((m) => m[1]);
  if (names.length === 0) return undefined;
  return z.object(Object.fromEntries(names.map((name) => [name, z.string()])));
}

export function registerApiRoute(route: RegisterRouteOptions): void {
  const operationId = route.operationId ?? deriveOperationId(route.method, route.path);
  const routeKey = `${route.method.toUpperCase()} ${route.path}`;
  const owner = registeredOperationIds.get(operationId);
  if (owner && owner !== routeKey) {
    throw new Error(
      `openapi: duplicate operationId "${operationId}" for ${routeKey}; already used by ${owner}. Set an explicit operationId on one of them.`,
    );
  }
  registeredOperationIds.set(operationId, routeKey);

  const etagHeader = z.object({
    ETag: z.string().openapi({
      description: "Weak validator for this response; send it back as If-None-Match.",
    }),
  });

  apiRegistry.registerPath({
    method: route.method,
    path: route.path,
    operationId,
    summary: route.summary,
    security: route.auth === "user" ? [{ bearerAuth: [] }] : [],
    request: {
      params: pathParamsSchema(route.path),
      headers: route.etag
        ? z.object({
            "If-None-Match": z.string().optional().openapi({
              description: "The ETag of the copy the client holds; a match answers 304.",
            }),
          })
        : undefined,
      body: route.input ? { content: { "application/json": { schema: route.input } } } : undefined,
    },
    responses: {
      200: {
        description: "OK",
        headers: route.etag ? etagHeader : undefined,
        content: { "application/json": { schema: route.output } },
      },
      ...(route.etag
        ? {
            304: {
              description: "Not Modified: unchanged since the ETag sent in If-None-Match.",
              headers: etagHeader,
            },
          }
        : {}),
      default: {
        description: "Error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  });
}

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(apiRegistry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Gradus API",
      version: "1.0.0",
      description: "Gradus /api/v1 — see docs/api/README.md and docs/ios/PRD.md §6.2.",
    },
    servers: [{ url: "https://gradus.training" }],
  });
}
