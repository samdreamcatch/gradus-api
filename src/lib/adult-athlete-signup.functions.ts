import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  adultGoalsInput,
  coachSportsInput,
  createSelfManagedAthlete as createSelfManagedAthleteShared,
  createSelfManagedAthleteInput,
  getAdultOnboardingStatus as getAdultOnboardingStatusShared,
  getCoachOfferedSportsForAdult as getCoachOfferedSportsForAdultShared,
  linkAdultAthleteToCoach as linkAdultAthleteToCoachShared,
  linkAdultCoachInput,
  listAdultAthleteCoaches as listAdultAthleteCoachesShared,
  previewCoachForAdultAthlete as previewCoachForAdultAthleteShared,
  saveAdultAthleteGoals as saveAdultAthleteGoalsShared,
  unlinkAdultAthleteFromCoach as unlinkAdultAthleteFromCoachShared,
  updateAdultAthleteCoachSports as updateAdultAthleteCoachSportsShared,
} from "./adult-athlete.server";
import { inviteCodeSchema } from "./invites.server";

export { athleteCanConnectCoach } from "./adult-athlete.server";

type Client = SupabaseClient<Database>;

/*
 * Thin wrappers over src/lib/adult-athlete.server.ts, shared with the
 * /api/v1/signup/adult-athlete and /api/v1/adult-athlete/* routes
 * (PRD §6.2). Reads and writes go through the caller's RLS client, except
 * creating the athlete row, which uses the admin client.
 */

async function adultContext(context: { userId: string; supabase: unknown }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId: context.userId, supabase: context.supabase as Client, admin: supabaseAdmin };
}

/**
 * Create the signed-in user's self-managed athlete row. Idempotent: if the
 * caller already has an athletes row we return it unchanged (birthdate is
 * locked once written). Under-18 athletes need a parent/guardian email.
 */
export const createSelfManagedAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSelfManagedAthleteInput.parse(input))
  .handler(async ({ data, context }) =>
    createSelfManagedAthleteShared(await adultContext(context), data),
  );

/** Preview a coach by invite code from the adult-athlete onboarding screen. */
export const previewCoachForAdultAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: inviteCodeSchema }).parse(input))
  .handler(async ({ data, context }) =>
    previewCoachForAdultAthleteShared(await adultContext(context), data.code),
  );

/** Link the caller's self-managed athlete row to a coach via that coach's invite code. */
export const linkAdultAthleteToCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => linkAdultCoachInput.parse(input))
  .handler(async ({ data, context }) =>
    linkAdultAthleteToCoachShared(await adultContext(context), data),
  );

/** Returns { hasAthlete, selfManaged, athleteId } for the signed-in adult athlete. */
export const getAdultOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    getAdultOnboardingStatusShared({
      userId: context.userId,
      supabase: context.supabase as Client,
    }),
  );

/** Upsert a goal for the caller's self-managed athlete. */
export const saveAdultAthleteGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => adultGoalsInput.parse(input))
  .handler(async ({ data, context }) =>
    saveAdultAthleteGoalsShared(await adultContext(context), data),
  );

/** List the caller's linked coaches (with per-coach sport scoping). */
export const listAdultAthleteCoaches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => listAdultAthleteCoachesShared(await adultContext(context)));

/** Unlink one of the caller's coaches. */
export const unlinkAdultAthleteFromCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ coachId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) =>
    unlinkAdultAthleteFromCoachShared(
      { userId: context.userId, supabase: context.supabase as Client },
      data.coachId,
    ),
  );

/** Replace the per-coach sport scoping for the caller. */
export const updateAdultAthleteCoachSports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    coachSportsInput.extend({ coachId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    updateAdultAthleteCoachSportsShared(await adultContext(context), data.coachId, {
      sports: data.sports,
    }),
  );

/** Return the coach's full offered sports so settings can offer adding sports. */
export const getCoachOfferedSportsForAdult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ coachId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) =>
    getCoachOfferedSportsForAdultShared(await adultContext(context), data.coachId),
  );
