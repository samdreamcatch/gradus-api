/**
 * Zod schemas for the parent sign-up DTOs, mirroring `parent-signup.server.ts`
 * field for field (`satisfies` keeps them honest), so the OpenAPI document
 * and the generated Swift client carry the real shapes.
 */
import { z } from "zod";
import type {
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

export const athletesForCodeSchema = z.object({
  coachId: z.string().nullable(),
  athletes: z.array(z.object({ id: z.string(), firstName: z.string(), lastName: z.string() })),
  sports: z.array(z.string()),
}) satisfies z.ZodType<AthletesForCode>;

export const codeResponseSchema = z.object({ code: z.string() });
