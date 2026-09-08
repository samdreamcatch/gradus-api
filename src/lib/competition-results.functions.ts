import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import {
  athleteIdInput,
  dismissCoachPostEvent as dismissCoachPostEventImpl,
  dismissCoachPostEventInput,
  generatePlanFromResults as generatePlanFromResultsImpl,
  generatePlanFromResultsInput,
  getAthleteCompetitionResults as getAthleteCompetitionResultsImpl,
  getCoachPostEventItems as getCoachPostEventItemsImpl,
  linkAthleteToSkater as linkAthleteToSkaterImpl,
  linkAthleteToSkaterInput,
  listCoachRosterForCompetition as listCoachRosterForCompetitionImpl,
  listFinishedCompetitions as listFinishedCompetitionsImpl,
  listSkaterMatches as listSkaterMatchesImpl,
  listSkaterMatchesInput,
  rosterForCompetitionInput,
  unlinkAthleteCompetition as unlinkAthleteCompetitionImpl,
  unlinkAthleteCompetitionInput,
} from "./competition-results.server";

// Re-export types and DTOs so existing web imports keep working.
export type {
  AthleteCompetitionLinkDTO,
  AthleteResultDTO,
  CoachPostEventAthleteDTO,
  CoachPostEventItemDTO,
  CoachRosterCandidateDTO,
  FinishedCompetitionDTO,
  SkaterMatchDTO,
} from "./competition-results.server";

/**
 * The competition tables are created by a staged migration, so they are not in
 * the generated types yet — reach them through the same loose accessor the
 * board functions use.
 */
async function getAdmin(): Promise<{ from: (t: string) => any }> {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin as unknown as { from: (t: string) => any };
}

/*
 * Thin wrappers over the shared entry points in
 * src/lib/competition-results.server.ts, shared with the
 * `/api/v1` "Live Board and competitions" results-linking routes
 * (PRD §7.10, Appendix A). Behavior and error messages are unchanged.
 */

export const listFinishedCompetitions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteIdInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await listFinishedCompetitionsImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const listSkaterMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listSkaterMatchesInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await listSkaterMatchesImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const linkAthleteToSkater = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => linkAthleteToSkaterInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await linkAthleteToSkaterImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const unlinkAthleteCompetition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => unlinkAthleteCompetitionInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await unlinkAthleteCompetitionImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const getAthleteCompetitionResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteIdInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await getAthleteCompetitionResultsImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const generatePlanFromResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => generatePlanFromResultsInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await generatePlanFromResultsImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const getCoachPostEventItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await getCoachPostEventItemsImpl(await getAdmin(), context.userId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const dismissCoachPostEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => dismissCoachPostEventInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await dismissCoachPostEventImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const listCoachRosterForCompetition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rosterForCompetitionInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await listCoachRosterForCompetitionImpl(await getAdmin(), context.userId, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });
