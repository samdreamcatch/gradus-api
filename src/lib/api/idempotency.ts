/**
 * Idempotency-Key replay for creating POSTs, per docs/ios/PRD.md §6.2.
 * Backed by `api_idempotency_keys` (supabase/migrations), scoped by
 * `(user_id, key)`, replaying the stored response for 24 hours.
 *
 * Reservation-based, via the `reserve_idempotency_key` / `complete_idempotency_key`
 * / `release_idempotency_key` Postgres functions (see the migration next to
 * this file): `reserve_idempotency_key` serializes concurrent callers for the
 * same `(user_id, key)` behind an advisory lock and hands out at most one
 * `'reserved'` — a second call for the same key arriving before the first
 * finishes gets `'in_progress'` instead of also running the handler (closing
 * the double-invoice race a plain "check row, then upsert on conflict" allows).
 * The stored `request_hash` also catches the same key reused with a
 * *different* body: that gets `'key_reused'` instead of silently replaying
 * the first response.
 *
 * `api_idempotency_keys` and its RPCs are not yet in the generated Supabase
 * `Database` type (that codegen runs separately and is out of scope
 * tonight), so access is cast the same way `src/routes/api/public/board/refresh.ts`
 * already does for ad-hoc table access.
 */
import { createHash } from "crypto";
import type { ApiContext } from "./auth";
import { ApiError } from "./errors";
import { dbError } from "@/lib/db-error";

export interface IdempotentResult {
  status: number;
  body: unknown;
}

type ReservationState = "reserved" | "replay" | "in_progress" | "key_reused";

interface ReservationRow {
  state: ReservationState;
  response_status: number | null;
  response_body: unknown;
}

/** Loose `rpc` shape, cast the same way this file casts `.from()` calls elsewhere in the API layer. */
type IdempotencyRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

const REPLAY_WINDOW_SECONDS = 24 * 60 * 60;
/**
 * How long a reservation with no recorded response is treated as abandoned
 * (the handler crashed or timed out) rather than genuinely in-flight, and so
 * eligible to be taken over by a fresh attempt instead of blocking on it for
 * the rest of the replay window.
 */
const PENDING_TIMEOUT_SECONDS = 60;

/**
 * SHA-256 of the exact request bytes. The caller (`define-route.ts`) computes
 * this from a `request.clone()` before the body is parsed, so it reflects the
 * literal wire body — JSON or multipart alike — and two requests that differ
 * in any way never hash the same.
 */
export function hashRequestBody(bytes: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function idempotencyKeyReused(): ApiError {
  return new ApiError({
    code: "idempotency_key_reused",
    status: 409,
    message: "This Idempotency-Key was already used with a different request.",
  });
}

function idempotencyInProgress(): ApiError {
  return new ApiError({
    code: "idempotency_key_in_progress",
    status: 409,
    message: "A request with this Idempotency-Key is already being processed.",
  });
}

/**
 * Runs `run()` at most once per `(ctx.userId, key)` within the replay
 * window; a repeat call with the same key and the same request body returns
 * the stored response instead of re-running the handler. A repeat call with
 * the same key and a *different* body, or one that arrives while the first
 * is still running, is rejected rather than replayed or re-run. A `null` key
 * (no `Idempotency-Key` header) always runs `run()`.
 */
export async function withIdempotency(
  ctx: ApiContext,
  key: string | null,
  bodyHash: string,
  run: () => Promise<IdempotentResult>,
): Promise<IdempotentResult> {
  if (!key) return run();

  const admin = ctx.admin as unknown as IdempotencyRpc;

  const { data, error } = await admin.rpc("reserve_idempotency_key", {
    _user_id: ctx.userId,
    _key: key,
    _request_hash: bodyHash,
    _replay_window_seconds: REPLAY_WINDOW_SECONDS,
    _pending_timeout_seconds: PENDING_TIMEOUT_SECONDS,
  });
  if (error) dbError(error as { message?: string; code?: string });

  const reservation = (data as ReservationRow[] | null)?.[0];
  if (!reservation) dbError({ message: "reserve_idempotency_key returned no row" });

  if (reservation.state === "replay") {
    return { status: reservation.response_status!, body: reservation.response_body };
  }
  if (reservation.state === "in_progress") throw idempotencyInProgress();
  if (reservation.state === "key_reused") throw idempotencyKeyReused();

  // "reserved": we own this key. Run the handler, then record the result —
  // or release the reservation on failure so a retry with the same key isn't
  // blocked for the rest of the replay window by a failed first attempt.
  let result: IdempotentResult;
  try {
    result = await run();
  } catch (err) {
    await admin.rpc("release_idempotency_key", { _user_id: ctx.userId, _key: key });
    throw err;
  }

  await admin.rpc("complete_idempotency_key", {
    _user_id: ctx.userId,
    _key: key,
    _response_status: result.status,
    _response_body: result.body,
  });

  return result;
}
