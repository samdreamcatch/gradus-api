/**
 * Zod schemas for the guardian claim DTOs, mirroring
 * `guardian-claim.server.ts` field for field (`satisfies` keeps them honest).
 * PRD §3.5, §7.8 "Parent or guardian", Appendix A "Guardians". Plain objects
 * with nullable fields only — no unions (Swift codegen, handoff §5).
 */
import { z } from "zod";
import type {
  GuardianClaimContextDTO,
  GuardianClaimResultDTO,
  GuardianClaimSummaryDTO,
  GuardianMergeOptionDTO,
  GuardianMergeOptionsDTO,
  GuardianStatusDTO,
  ResendGuardianInviteResultDTO,
} from "@/lib/guardian-claim.server";

export const guardianInviteRecipientSchema = z.enum(["guardian", "athlete"]);

export const guardianClaimSummarySchema = z.object({
  athleteFirstName: z.string(),
  athleteLastName: z.string(),
  coachName: z.string().nullable(),
  needsBirthdate: z.boolean(),
  inviteRecipient: guardianInviteRecipientSchema,
  alreadyClaimed: z.boolean(),
}) satisfies z.ZodType<GuardianClaimSummaryDTO>;

export const guardianClaimContextSchema = z.object({
  hasParentProfile: z.boolean(),
  parentName: z.string().nullable(),
}) satisfies z.ZodType<GuardianClaimContextDTO>;

export const guardianClaimResultSchema = z.object({
  ok: z.literal(true),
  athleteFirstName: z.string(),
}) satisfies z.ZodType<GuardianClaimResultDTO>;

export const guardianMergeRankSchema = z.enum(["exact", "close", "other"]);

export const guardianMergeOptionSchema = z.object({
  athleteId: z.string(),
  name: z.string(),
  rank: guardianMergeRankSchema,
}) satisfies z.ZodType<GuardianMergeOptionDTO>;

export const guardianMergeOptionsSchema = z.object({
  options: z.array(guardianMergeOptionSchema),
}) satisfies z.ZodType<GuardianMergeOptionsDTO>;

export const resendGuardianInviteResultSchema = z.object({
  ok: z.literal(true),
  guardianEmail: z.string(),
}) satisfies z.ZodType<ResendGuardianInviteResultDTO>;

export const guardianStatusSchema = z.object({
  athleteId: z.string(),
  isMinor: z.boolean(),
  guardianEmail: z.string().nullable(),
  claimed: z.boolean(),
  invitedAt: z.string().nullable(),
}) satisfies z.ZodType<GuardianStatusDTO>;

/** `{ status: null }` when the caller has no athlete row (wrapped like `athleteSettingsResponseSchema`). */
export const guardianStatusResponseSchema = z.object({
  status: guardianStatusSchema.nullable(),
}) satisfies z.ZodType<{ status: GuardianStatusDTO | null }>;
