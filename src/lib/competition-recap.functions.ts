import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import { recordAttendance } from "./competitions.server";
import {
  athleteRecapsInput,
  dismissCompetitionRecap as dismissCompetitionRecapImpl,
  dismissCompetitionRecapInput,
  getAthleteCompetitionRecaps as getAthleteCompetitionRecapsImpl,
  getPendingCompetitionRecap as getPendingCompetitionRecapImpl,
  getRecapCoaches as getRecapCoachesImpl,
  recapCoachesInput,
  submitCompetitionRecap as submitCompetitionRecapImpl,
  submitCompetitionRecapInput,
} from "./competition-recap.server";

// Re-export types so existing web imports keep working.
export type { CompetitionRecapDTO, PendingRecapDTO } from "./competition-recap.server";

/**
 * End-of-competition recap. A signed-in parent or athlete who opens a live
 * board at a competition is asked, once it finishes, how it went. The answer
 * is stored on the athlete's record and sent to their coach as a message.
 *
 * Thin wrappers over the shared entry points in
 * src/lib/competition-recap.server.ts (and, for attendance,
 * src/lib/competitions.server.ts), shared with the `/api/v1` "recaps" routes
 * (PRD §7.10, Appendix A). Behavior and error messages are unchanged.
 */
async function getAdmin(): Promise<{ from: (t: string) => any }> {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin as unknown as { from: (t: string) => any };
}

/* ----------------------------------------------------------- attendance */

/** Thin wrapper over the shared `recordAttendance` (src/lib/competitions.server.ts). */
export const recordCompetitionAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ slug: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    return recordAttendance(await getAdmin(), context.userId, { slug: data.slug });
  });

/* -------------------------------------------------------- pending prompt */

export const getPendingCompetitionRecap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await getPendingCompetitionRecapImpl(await getAdmin(), context.userId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const dismissCompetitionRecap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => dismissCompetitionRecapInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await dismissCompetitionRecapImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/* ------------------------------------------------------- coach recipients */

export const getRecapCoaches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => recapCoachesInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await getRecapCoachesImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/* ------------------------------------------------------------- the recap */

export const submitCompetitionRecap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => submitCompetitionRecapInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await submitCompetitionRecapImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/* -------------------------------------------------------------- reading */

export const getAthleteCompetitionRecaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteRecapsInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await getAthleteCompetitionRecapsImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });
