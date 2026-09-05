/**
 * Idempotency-Key replay for creating POSTs, per docs/ios/PRD.md §6.2.
 * Backed by `api_idempotency_keys` (supabase/migrations), scoped by
 * `(user_id, key)`, replaying the stored response for 24 hours.
 *
 * `api_idempotency_keys` is not yet in the generated Supabase `Database`
 * type (that codegen runs separately and is out of scope tonight), so table
 * access is cast the same way `src/routes/api/public/board/refresh.ts`
 * already does for ad-hoc table access.
 */
import type { ApiContext } from "./auth";

export interface IdempotentResult {
  status: number;
  body: unknown;
}

interface IdempotencyRow {
  response_status: number;
  response_body: unknown;
  created_at: string;
}

type IdempotencyTable = {
  from: (table: "api_idempotency_keys") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (
          column: string,
          value: string,
        ) => { maybeSingle: () => Promise<{ data: IdempotencyRow | null; error: unknown }> };
      };
    };
    upsert: (
      row: {
        user_id: string;
        key: string;
        response_status: number;
        response_body: unknown;
        created_at: string;
      },
      opts: { onConflict: string },
    ) => Promise<{ data: unknown; error: unknown }>;
  };
};

const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Runs `run()` at most once per `(ctx.userId, key)` within the replay
 * window; a repeat call with the same key returns the stored response
 * instead of re-running the handler. A `null` key (no `Idempotency-Key`
 * header) always runs `run()`.
 */
export async function withIdempotency(
  ctx: ApiContext,
  key: string | null,
  run: () => Promise<IdempotentResult>,
): Promise<IdempotentResult> {
  if (!key) return run();

  const table = (ctx.admin as unknown as IdempotencyTable).from("api_idempotency_keys");

  const { data: existing } = await table
    .select("response_status, response_body, created_at")
    .eq("user_id", ctx.userId)
    .eq("key", key)
    .maybeSingle();

  if (existing && Date.now() - new Date(existing.created_at).getTime() < REPLAY_WINDOW_MS) {
    return { status: existing.response_status, body: existing.response_body };
  }

  const result = await run();

  await table.upsert(
    {
      user_id: ctx.userId,
      key,
      response_status: result.status,
      response_body: result.body,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id,key" },
  );

  return result;
}
