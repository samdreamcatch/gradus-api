/**
 * Team plan — coach visibility.
 *
 * A parent on an active Team plan can let an athlete's coaches see one
 * another's work for that athlete. The parent opts each coach in; every pair of
 * opted-in coaches gets a link that BOTH coaches must accept before anything is
 * shared. The window is always two-way: read-only parity, that athlete only.
 *
 * Thin wrappers over the shared entry points in
 * src/lib/coach-visibility.server.ts, shared with the `/api/v1` parent
 * coach-visibility and coach visibility routes (PRD Appendix A). Behavior and
 * error messages are unchanged.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import {
  disconnectCoachVisibility as disconnectCoachVisibilityImpl,
  disconnectCoachVisibilityInput,
  listCoachVisibility as listCoachVisibilityImpl,
  listMyCoachVisibility as listMyCoachVisibilityImpl,
  respondToCoachVisibility as respondToCoachVisibilityImpl,
  respondToCoachVisibilityInput,
  setCoachVisibility as setCoachVisibilityImpl,
  setCoachVisibilityInput,
} from "./coach-visibility.server";

// Re-export types so web imports can name the shapes.
export type {
  CoachShareStatus,
  CoachVisibilityAthleteDTO,
  CoachVisibilityCoachDTO,
  CoachVisibilityDTO,
  MyCoachVisibilityDTO,
  MyVisibilityLinkDTO,
  VisibilityLinkStatus,
  VisibilityPairDTO,
} from "./coach-visibility.server";

async function getAdmin() {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin;
}

/** Athletes the caller can reach, their coaches, and each coach's share state. */
export const listCoachVisibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await listCoachVisibilityImpl(await getAdmin(), context.userId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** Parent turns sharing on or off for one coach on one athlete. */
export const setCoachVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setCoachVisibilityInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await setCoachVisibilityImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** Visibility requests waiting on the signed-in coach, plus connected coaches. */
export const listMyCoachVisibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await listMyCoachVisibilityImpl(await getAdmin(), context.userId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** Coach accepts or declines a visibility request. */
export const respondToCoachVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => respondToCoachVisibilityInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await respondToCoachVisibilityImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** Coach turns an existing connection back off. */
export const disconnectCoachVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => disconnectCoachVisibilityInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await disconnectCoachVisibilityImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });
