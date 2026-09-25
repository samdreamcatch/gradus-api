/**
 * Zod schemas for the parent adult-verification DTOs, mirroring
 * `guardian-verification.server.ts` field for field (`satisfies` keeps them
 * honest). PRD §6.13 A1–A2, Appendix A "Invites and connections" and
 * "Consent webhooks". Plain objects with nullable fields only, no unions
 * (Swift codegen).
 */
import { z } from "zod";
import type {
  CompleteVerificationResult,
  ParentVerificationDTO,
  StartParentVerificationResult,
} from "@/lib/guardian-verification.server";

export const adultVerificationMethodSchema = z.enum(["kws_card", "admin", "legacy"]);
export const athleteAccountStateSchema = z.enum(["active", "provisional", "paused"]);

export const parentVerificationSchema = z.object({
  required: z.boolean(),
  available: z.boolean(),
  verified: z.boolean(),
  method: adultVerificationMethodSchema.nullable(),
  verifiedAt: z.string().nullable(),
  requestedAt: z.string().nullable(),
}) satisfies z.ZodType<ParentVerificationDTO>;

/** `{ verification: null }` when the caller has no parent profile. */
export const parentVerificationResponseSchema = z.object({
  verification: parentVerificationSchema.nullable(),
}) satisfies z.ZodType<{ verification: ParentVerificationDTO | null }>;

export const startParentVerificationResultSchema = z.object({
  status: z.enum(["email_sent", "already_verified", "not_configured", "rate_limited"]),
}) satisfies z.ZodType<StartParentVerificationResult>;

export const completeVerificationResultSchema = z.object({
  ok: z.boolean(),
  verified: z.boolean(),
  duplicate: z.boolean(),
  reason: z.string().nullable(),
}) satisfies z.ZodType<CompleteVerificationResult>;
