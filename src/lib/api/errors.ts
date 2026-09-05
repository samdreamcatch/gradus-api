/**
 * `/api/v1` error shape and mapping, per docs/ios/PRD.md §6.2:
 * `{"error": {"code", "message", "details"}}` with stable snake_case codes.
 */
import { ZodError } from "zod";
import { isRosterFullError } from "@/lib/roster-limits";

export interface ApiErrorShape {
  code: string;
  status: number;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor({ code, status, message, details }: ApiErrorShape) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static disabled(): ApiError {
    return new ApiError({
      code: "api_disabled",
      status: 503,
      message: "The API is temporarily disabled.",
    });
  }

  static unauthenticated(message = "Authentication required."): ApiError {
    return new ApiError({ code: "unauthenticated", status: 401, message });
  }

  static validation(zodError: ZodError): ApiError {
    return new ApiError({
      code: "validation_failed",
      status: 400,
      message: "Request validation failed.",
      details: zodError.flatten(),
    });
  }

  static rateLimited(retryAfterSeconds: number): ApiError {
    return new ApiError({
      code: "rate_limited",
      status: 429,
      message: "Too many requests. Please slow down.",
      details: { retryAfterSeconds },
    });
  }
}

/** Serializes an ApiError into the PRD §6.2 JSON error shape. */
export function toResponse(error: ApiError): Response {
  const headers = new Headers();
  if (error.code === "rate_limited") {
    const retryAfterSeconds = (error.details as { retryAfterSeconds?: number } | undefined)
      ?.retryAfterSeconds;
    if (typeof retryAfterSeconds === "number") {
      headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
    }
  }
  return Response.json(
    { error: { code: error.code, message: error.message, details: error.details } },
    { status: error.status, headers },
  );
}

/**
 * Maps any thrown value to an ApiError. Zod failures become `validation_failed`
 * (400); the roster-cap trigger's "Roster full:" message (see
 * src/lib/roster-limits.ts) becomes `roster_full` (409); everything else is
 * logged server-side and surfaced as a generic `internal` (500) with no
 * internal detail leaked to the client.
 */
export function normalizeError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) return ApiError.validation(err);
  if (isRosterFullError(err)) {
    return new ApiError({
      code: "roster_full",
      status: 409,
      message: err instanceof Error ? err.message : "Roster full.",
    });
  }
  console.error("[api] unhandled error", err);
  return new ApiError({
    code: "internal",
    status: 500,
    message: "Something went wrong. Please try again.",
  });
}
