/**
 * Zod schemas for the parent sign-up DTOs, mirroring `parent-signup.server.ts`
 * field for field (`satisfies` keeps them honest), so the OpenAPI document
 * and the generated Swift client carry the real shapes.
 */
import { z } from "zod";
import type {
  AthleteGoalPrefill,
  AthletesForCode,
  CoachPreview,
  ParentSignupStatus,
  SignupCodeValidation,
} from "@/lib/parent-signup.server";

export const signupCodeValidationSchema = z.union([
  z.object({ kind: z.literal("beta") }),
  z.object({ kind: z.literal("coach"), coachId: z.string() }),
]) satisfies z.ZodType<SignupCodeValidation>;

export const startParentSignupResultSchema = z.object({ code: z.string().nullable() });

export const parentSignupStatusSchema = z.object({
  hasParentProfile: z.boolean(),
  hasAthletes: z.boolean(),
  hasAnyCoach: z.boolean(),
  inviteCode: z.string().nullable(),
}) satisfies z.ZodType<ParentSignupStatus>;

export const coachPreviewSchema = z.object({
  coachId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  sports: z.array(z.string()),
}) satisfies z.ZodType<CoachPreview>;

/**
 * A goal already on file for an athlete (decision #60, 2026-10-27), so the
 * sign-up goals step opens prefilled. `suggestedByCoachName` is set while the
 * goal is still the coach's starting levels from the invite; the client says
 * "Suggested by Coach <name>. Change anything that doesn't fit."
 */
export const goalPrefillSchema = z.object({
  sport: z.string(),
  currentLevelKey: z.string(),
  seasonGoalKey: z.string(),
  longTermGoal: z.string(),
  suggestedByCoach: z.boolean(),
  suggestedByCoachName: z.string().nullable(),
}) satisfies z.ZodType<AthleteGoalPrefill>;

export const athletesForCodeSchema = z.object({
  coachId: z.string().nullable(),
  athletes: z.array(
    z.object({
      id: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      goals: z.array(goalPrefillSchema),
    }),
  ),
  sports: z.array(z.string()),
}) satisfies z.ZodType<AthletesForCode>;

export const codeResponseSchema = z.object({ code: z.string() });
