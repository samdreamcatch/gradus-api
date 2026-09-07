/**
 * Zod schema for the coach billing summary DTO, mirroring
 * `coach-billing.server.ts` field for field (`satisfies` keeps it honest),
 * so the OpenAPI document and the generated Swift client carry the real
 * shape (PRD §6.8, Appendix A "Billing").
 */
import { z } from "zod";
import type { CoachBillingDTO } from "@/lib/coach-billing.server";
import { coachEffectiveTierSchema, coachEntitlementSchema } from "./onboarding-schema";

export const coachBillingSchema = z.object({
  entitlement: coachEntitlementSchema,
  effectiveTier: coachEffectiveTierSchema,
  subscriptionTier: z.enum(["coach", "coach_pro"]).nullable(),
  subscriptionStatus: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  hasStripeCustomer: z.boolean(),
  foundingCoach: z.boolean(),
  foundingProTrialUsed: z.boolean(),
  freeAccessUntil: z.string().nullable(),
  trialNeedsCard: z.boolean(),
  billingPastDue: z.boolean(),
  athleteLimit: z.number().int().nullable(),
  athleteCount: z.number().int(),
  organizationName: z.string().nullable(),
  promoLabel: z.string().nullable(),
  promoPercentOff: z.number(),
  manageUrl: z.string(),
}) satisfies z.ZodType<CoachBillingDTO>;
