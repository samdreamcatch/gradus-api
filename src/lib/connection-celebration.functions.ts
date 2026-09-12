import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ApiError, rethrowPlain } from "./api/errors";
import {
  ackCelebrationInput,
  acknowledgeConnection as acknowledgeConnectionImpl,
  getPendingConnectionCelebrations as getPendingConnectionCelebrationsImpl,
} from "./connection-celebration.server";

// Re-export types so existing web imports keep working.
export type { CelebrationRole } from "./connection-celebration.server";
export type {
  CelebrationGroupDTO as CelebrationGroup,
  CelebrationPayloadDTO as CelebrationPayload,
} from "./connection-celebration.server";

/**
 * Connection celebration — thin wrappers over the shared entry points in
 * src/lib/connection-celebration.server.ts, shared with the
 * `/api/v1/me/celebrations` routes (PRD §7.14, Appendix A "Me"). Behavior
 * is unchanged for the web: the historical role precedence is kept (the
 * `apiContract` flag stays off here), and a caller with no role still gets
 * `{ ok: false }` from `acknowledgeConnection`.
 */
async function getAdmin() {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin;
}

/**
 * Returns pending connection celebrations for the caller.
 * Coach: unacked (`coach_ack_at IS NULL`) roster links, grouped by parent
 *   (siblings collapse into one entry).
 * Parent: unacked (`other_ack_at IS NULL`) links for that parent's athletes,
 *   grouped by coach.
 * Adult athlete: unacked links for the caller's self-managed athlete row.
 */
export const getPendingConnectionCelebrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await getPendingConnectionCelebrationsImpl(await getAdmin(), context.userId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * Marks the given link ids as acknowledged from the caller's side.
 * Verifies ownership before updating — a coach can only ack rows where
 * they're the coach, a parent/adult-athlete can only ack rows for their
 * own athletes. `{ ok: false }` when the caller has no role.
 */
export const acknowledgeConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ackCelebrationInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    try {
      return await acknowledgeConnectionImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      if (err instanceof ApiError && err.code === "wrong_role") return { ok: false };
      rethrowPlain(err);
    }
  });
