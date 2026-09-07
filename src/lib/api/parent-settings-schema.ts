/**
 * Zod schemas for the parent settings DTOs, mirroring
 * `parent-settings.server.ts` field for field (`satisfies` keeps them
 * honest), so the OpenAPI document and the generated Swift client carry
 * the real shapes.
 */
import { z } from "zod";
import type { ParentSettingsDTO } from "@/lib/parent-settings.server";
import { scheduleSlotSchema } from "./athlete-schema";

const parentSettingsCoachSchema = z.object({
  coachId: z.string(),
  coachName: z.string(),
  sports: z.array(z.string()),
});

const parentSettingsSportSchema = z.object({
  sport: z.string(),
  primaryCoachId: z.string().nullable(),
  primaryCoachName: z.string().nullable(),
  eligibleCoaches: z.array(z.object({ coachId: z.string(), coachName: z.string() })),
  goals: z
    .object({
      currentLevelKey: z.string(),
      seasonGoalKey: z.string(),
      longTermGoal: z.string(),
    })
    .nullable(),
});

const parentSettingsScheduleSchema = z.object({
  coachId: z.string(),
  coachName: z.string(),
  slots: z.array(scheduleSlotSchema),
});

export const parentSettingsAthleteSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  birthdate: z.string().nullable(),
  username: z.string().nullable(),
  hasAccount: z.boolean(),
  inviteCode: z.string().nullable(),
  coaches: z.array(parentSettingsCoachSchema),
  sports: z.array(parentSettingsSportSchema),
  schedulesByCoach: z.array(parentSettingsScheduleSchema),
});

export const parentSettingsSchema = z.object({
  profile: z.object({ firstName: z.string(), lastName: z.string() }),
  athletes: z.array(parentSettingsAthleteSchema),
}) satisfies z.ZodType<ParentSettingsDTO>;

export const addParentAthleteResultSchema = z.object({
  ok: z.literal(true),
  athleteId: z.string(),
});

export const resetAthletePasswordResultSchema = z.object({
  ok: z.literal(true),
  username: z.string().nullable(),
});
