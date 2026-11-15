/**
 * Zod schemas for the athlete sign-up DTOs, mirroring `athlete-signup.server.ts`
 * and `adult-athlete.server.ts` field for field (`satisfies` keeps them
 * honest), so the OpenAPI document and the generated Swift client carry the
 * real shapes.
 */
import { z } from "zod";
import { goalPrefillSchema } from "./signup-schema";
import type { AthleteInviteSummary, MyAthlete } from "@/lib/athlete-signup.server";
import type {
  AdultCoachList,
  AdultCoachPreview,
  AdultGoalsList,
  AdultOnboardingStatus,
  CoachScheduleDTO,
} from "@/lib/adult-athlete.server";

export const athleteInviteSummarySchema = z.object({
  athleteFirstName: z.string(),
  athleteLastName: z.string(),
  coachFirstName: z.string().nullable(),
  coachLastName: z.string().nullable(),
  sports: z.array(z.string()),
}) satisfies z.ZodType<AthleteInviteSummary>;

export const athleteClaimResultSchema = z.object({ ok: z.literal(true), athleteId: z.string() });

export const usernameSignupResultSchema = z.object({ email: z.string(), athleteId: z.string() });

export const myAthleteSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
}) satisfies z.ZodType<MyAthlete>;

export const myAthleteResponseSchema = z.object({ athlete: myAthleteSchema.nullable() });

export const athleteIdResultSchema = z.object({ athleteId: z.string() });

export const adultCoachPreviewSchema = z.object({
  coachId: z.string(),
  coachName: z.string(),
  sports: z.array(z.string()),
}) satisfies z.ZodType<AdultCoachPreview>;

export const adultCoachLinkResultSchema = z.object({ ok: z.literal(true), coachId: z.string() });

export const adultOnboardingStatusSchema = z.object({
  hasAthlete: z.boolean(),
  selfManaged: z.boolean(),
  athleteId: z.string().nullable(),
}) satisfies z.ZodType<AdultOnboardingStatus>;

/** `GET /adult-athlete/goals`: the caller's goals per sport, with the coach's suggestion flag (decision #60). */
export const adultGoalsListSchema = z.object({
  goals: z.array(goalPrefillSchema),
}) satisfies z.ZodType<AdultGoalsList>;

export const adultCoachListSchema = z.object({
  hasAthlete: z.boolean(),
  canConnectCoach: z.boolean(),
  needsGuardianEmail: z.boolean(),
  coaches: z.array(
    z.object({ coachId: z.string(), coachName: z.string(), sports: z.array(z.string()) }),
  ),
}) satisfies z.ZodType<AdultCoachList>;

export const sportsResponseSchema = z.object({ sports: z.array(z.string()) });

/**
 * Integers, like the SMALLINT columns they come from and the `lessonSlotSchema`
 * write side, so the Swift client reads and writes the same `Int` fields
 * (a `number` here would have generated `Double` on the read side only).
 */
export const scheduleSlotSchema = z.object({
  dayOfWeek: z.number().int(),
  startMinute: z.number().int(),
  endMinute: z.number().int(),
  frequency: z.enum(["weekly", "biweekly", "twice_monthly", "monthly"]),
  weeksOfMonth: z.array(z.number().int()),
  startsOn: z.string().nullable(),
  /**
   * True on a group lesson (decision #68). The only thing a parent or athlete
   * learns about a group: never who else is in it, or how many. Optional so
   * an older build decodes the schedule unchanged.
   */
  group: z.boolean().optional(),
});

export const coachScheduleSchema = z.object({
  coachId: z.string(),
  coachName: z.string(),
  slots: z.array(scheduleSlotSchema),
}) satisfies z.ZodType<CoachScheduleDTO>;

export const adultSchedulesSchema = z.object({ coaches: z.array(coachScheduleSchema) });
