import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import { inviteCodeSchema } from "./invites.server";
import {
  addParentAthlete,
  athletePasswordInput,
  coachSportsInput,
  getParentSettings as getParentSettingsShared,
  linkCoachInput,
  linkParentAthleteToCoach,
  newParentAthleteInput,
  parentAthleteGoalsInput,
  parentAthleteInput,
  parentProfileInput,
  parentScheduleInput,
  previewCoachByInviteCode as previewCoachByInviteCodeShared,
  primaryCoachInput,
  removeParentAthlete,
  replaceParentAthleteSchedule,
  resetParentAthletePassword,
  setParentAthleteCoachSports,
  setParentAthleteGoals,
  setParentPrimaryCoach,
  unlinkParentAthleteFromCoach,
  updateParentAthlete,
  updateParentProfile as updateParentProfileShared,
  setParentAthleteCoachMessagingPause,
} from "./parent-settings.server";

export type {
  CoachPreviewDTO,
  ParentSettingsAthleteDTO,
  ParentSettingsCoachDTO,
  ParentSettingsDTO,
  ParentSettingsScheduleDTO,
  ParentSettingsSlotDTO,
  ParentSettingsSportDTO,
} from "./parent-settings.server";

/*
 * Thin wrappers over src/lib/parent-settings.server.ts, shared with the
 * /api/v1/parent/settings, /api/v1/parent/profile, and
 * /api/v1/parent/athletes* routes (PRD §7.7). Behavior is unchanged: every
 * handler still uses the admin client, and the web keeps its original
 * plain-Error messages via `rethrowPlain`.
 */

async function parentContext(context: { userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId: context.userId, admin: supabaseAdmin };
}

const athleteIdInput = z.object({ athleteId: z.string().uuid() });
const athleteCoachIdsInput = z.object({
  athleteId: z.string().uuid(),
  coachId: z.string().uuid(),
});

/** Full settings snapshot for the parent. */
export const getParentSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await getParentSettingsShared(await parentContext(context));
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const updateParentProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parentProfileInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await updateParentProfileShared(await parentContext(context), data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const updateAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteIdInput.merge(parentAthleteInput).parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { athleteId, ...rest } = data;
      return await updateParentAthlete(await parentContext(context), athleteId, rest);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const updateAthleteGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteIdInput.merge(parentAthleteGoalsInput).parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { athleteId, ...rest } = data;
      return await setParentAthleteGoals(await parentContext(context), athleteId, rest);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * Look up a coach by invite code so the parent can pick which sports apply
 * to their athlete before linking. Does not mutate anything.
 */
export const previewCoachByInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: inviteCodeSchema }).parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await previewCoachByInviteCodeShared(await parentContext(context), data.code);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const linkAthleteToCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteIdInput.merge(linkCoachInput).parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { athleteId, ...rest } = data;
      return await linkParentAthleteToCoach(await parentContext(context), athleteId, rest);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * Replace the set of sports an athlete does with a coach. If a sport is
 * removed and that coach was the primary for it, clear the primary row.
 */
export const updateCoachAthleteSports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteCoachIdsInput.merge(coachSportsInput).parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await setParentAthleteCoachSports(
        await parentContext(context),
        data.athleteId,
        data.coachId,
        { sports: data.sports },
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const unlinkAthleteFromCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteCoachIdsInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await unlinkParentAthleteFromCoach(
        await parentContext(context),
        data.athleteId,
        data.coachId,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const setPrimaryCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteIdInput.merge(primaryCoachInput).parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { athleteId, ...rest } = data;
      return await setParentPrimaryCoach(await parentContext(context), athleteId, rest);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const replaceAthleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteIdInput.merge(parentScheduleInput).parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { athleteId, ...rest } = data;
      return await replaceParentAthleteSchedule(await parentContext(context), athleteId, rest);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const addAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => newParentAthleteInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await addParentAthlete(await parentContext(context), data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const removeAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteIdInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      return await removeParentAthlete(await parentContext(context), data.athleteId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * Reset (or set) the password for one of the parent's athletes. Only works
 * for athletes that have an account (user_id is set). Used by the parent
 * settings page since username-only athletes have no email-based recovery.
 */
export const resetAthletePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteIdInput.merge(athletePasswordInput).parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { athleteId, ...rest } = data;
      return await resetParentAthletePassword(await parentContext(context), athleteId, rest);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * Pause or resume messaging between one coach and the athlete (PRD §6.13 C,
 * the SafeSport discontinue-contact rule). Both directions stop while paused.
 */
export const setCoachMessagingPause = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    athleteCoachIdsInput.extend({ paused: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      return await setParentAthleteCoachMessagingPause(
        await parentContext(context),
        data.athleteId,
        data.coachId,
        { paused: data.paused },
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });
