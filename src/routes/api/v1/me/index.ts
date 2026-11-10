import { athleteMayPurchase } from "@/lib/plan-purchases.server";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { deleteMyAccountRoute } from "@/lib/api/account-routes";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
import {
  athleteAccountStateSchema,
  parentVerificationSchema,
} from "@/lib/api/guardian-verification-schema";
import {
  PARENT_VERIFICATION_COLUMNS,
  toParentVerificationDTO,
  type AthleteAccountState,
  type ParentVerificationRow,
} from "@/lib/guardian-verification.server";
import { callerSports } from "@/lib/caller-sports.server";
import { isMinorOrUnconfirmed } from "@/lib/athlete-age";
import { getAiConsent } from "@/lib/ai-consent.server";

const outputSchema = z.object({
  userId: z.string(),
  /** Same precedence as the web's `getMyRole`; `null` until a profile exists. */
  role: z.enum(["coach", "parent", "athlete", "org_admin"]).nullable(),
  /** Coach only: whether onboarding has finished. `null` for other roles. */
  onboardingComplete: z.boolean().nullable(),
  terms: z.object({
    accepted: z.boolean(),
    version: z.string(),
    acceptedAt: z.string().nullable(),
  }),
  /** Parent only (PRD §6.13 A1): adult-verification state; `null` for other roles. */
  parentVerification: parentVerificationSchema.nullable(),
  /** Athlete only (PRD §6.13 A4): `active`, `provisional` or `paused`; `null` for other roles. */
  athleteAccountState: athleteAccountStateSchema.nullable(),
  /**
   * Athlete only (decision #48): whether this athlete may make plans by voice.
   * False under 18 or with no birthdate on file (the server refuses their audio
   * with 403 `text_only`); `null` for other roles. Always sent; optional in the
   * contract, and an app treats a missing value as false, so a build that reads
   * it never offers voice to a minor against an older server.
   */
  athleteVoiceToPlan: z.boolean().nullable().optional(),
  /**
   * Athlete only: whether this athlete may buy marketplace plans themselves
   * (src/lib/plan-purchases.server.ts): an active account, 13 or older by
   * birthdate. False when provisional, paused, under 13 or with no birthdate
   * (their parent buys); `null` for other roles. Optional in the contract; an
   * app treats a missing value as false.
   */
  athleteCanPurchase: z.boolean().nullable().optional(),
  /**
   * Sport keys this account touches (a coach's levels; a parent's or
   * athlete's goal and coached sports), sorted. The iOS shell shows the Live
   * board only when this includes `figure_skating` (2026-09-26). Empty for
   * org admins and callers without a profile. Always sent; optional in the
   * contract so an app build that reads it still decodes an older server.
   */
  sports: z.array(z.string()).optional(),
  /**
   * The caller's answer to the AI permission screen (App Review 5.1.2(i);
   * `GET`/`PUT /me/ai-consent`). The app shows the screen while it is
   * `unasked`, to everyone but athletes under 18. Always sent; optional in
   * the contract so an app build that reads it still decodes an older server.
   */
  aiConsent: z
    .object({
      state: z.enum(["granted", "declined", "unasked"]),
      version: z.string(),
      decidedAt: z.string().nullable(),
    })
    .optional(),
});

/**
 * Minimal `GET /me` (PRD Appendix A): role, onboarding state, and terms
 * status, which is what the iOS app shell needs to pick the tab bar and the
 * blocking terms sheet (milestone I1). It grows into the full composite
 * (profile summary, entitlement, guardian status, flags, unread count, ETag)
 * in B3 by adding fields, never changing these. S1 (2026-09-24) added the
 * parent's adult-verification state and the athlete's account state
 * (PRD §6.13 A1, A4).
 *
 * Role resolution reproduces `getMyRole` in
 * `src/lib/parent-signup.functions.ts` through `ctx.admin` (same tables,
 * same precedence) rather than importing it, so the web function is untouched.
 *
 * `DELETE /me` (PRD §6.4 "Delete account") lives in
 * `src/lib/api/account-routes.ts`: the client must send the JSON body
 * (`confirmPhrase`, `minorChoices`) with the DELETE request — `defineApiRoute`
 * parses a body for any method once `input` is set.
 */
export const Route = createFileRoute("/api/v1/me/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/me",
        operationId: "getMe",
        auth: "user",
        summary: "Session summary for the caller: role, onboarding state, terms status",
        output: outputSchema,
        handler: async ({ ctx }) => {
          const { admin, userId } = requireContext(ctx);
          const [coach, parent, athlete, orgAdmin, terms, aiConsent] = await Promise.all([
            admin
              .from("coach_profiles")
              .select("id, onboarded_at")
              .eq("user_id", userId)
              .maybeSingle(),
            admin
              .from("parent_profiles")
              .select(PARENT_VERIFICATION_COLUMNS)
              .eq("user_id", userId)
              .maybeSingle(),
            // No .limit(1): the row's account_state is read, so a duplicate
            // user_id must surface (PGRST116) instead of an arbitrary row.
            admin
              .from("athletes")
              .select("id, account_state, birthdate")
              .eq("user_id", userId)
              .maybeSingle(),
            admin.from("org_admins").select("id").eq("user_id", userId).limit(1).maybeSingle(),
            admin
              .from("terms_acceptances")
              .select("terms_version, accepted_at")
              .eq("user_id", userId)
              .eq("terms_version", CURRENT_TERMS_VERSION)
              .maybeSingle(),
            // Never fails `/me`: the AI routes check permission on their own.
            getAiConsent(admin, userId).catch((err) => {
              console.error("[api] me ai-consent", err);
              return undefined;
            }),
          ]);
          const failed = [coach, parent, athlete, orgAdmin, terms].find((r) => r.error);
          if (failed?.error) {
            console.error("[api] me", failed.error);
            throw new ApiError({
              code: "internal",
              status: 500,
              message: "Something went wrong. Please try again.",
            });
          }

          let role: "coach" | "parent" | "athlete" | "org_admin" | null = null;
          let onboardingComplete: boolean | null = null;
          if (coach.data?.onboarded_at) {
            role = "coach";
            onboardingComplete = true;
          } else if (parent.data) role = "parent";
          else if (athlete.data) role = "athlete";
          else if (coach.data) {
            role = "coach";
            onboardingComplete = false;
          } else if (orgAdmin.data) role = "org_admin";

          const sports = await callerSports(
            admin,
            role === "coach" && coach.data
              ? { role: "coach", coachId: coach.data.id as string }
              : role === "parent" && parent.data
                ? { role: "parent", parentId: (parent.data as { id: string }).id }
                : role === "athlete" && athlete.data
                  ? { role: "athlete", athleteId: athlete.data.id as string }
                  : { role: "none" },
          );

          const parentRow = parent.data as ParentVerificationRow | null;
          const athleteRow = athlete.data as {
            account_state?: string | null;
            birthdate?: string | null;
          } | null;

          return {
            userId,
            role,
            onboardingComplete,
            terms: {
              accepted: !!terms.data,
              version: CURRENT_TERMS_VERSION,
              acceptedAt: terms.data?.accepted_at ?? null,
            },
            parentVerification: parentRow ? toParentVerificationDTO(parentRow) : null,
            athleteAccountState: athleteRow
              ? ((athleteRow.account_state as AthleteAccountState | null | undefined) ?? "active")
              : null,
            athleteVoiceToPlan:
              role === "athlete" && athleteRow ? !isMinorOrUnconfirmed(athleteRow.birthdate) : null,
            athleteCanPurchase:
              role === "athlete" && athleteRow ? athleteMayPurchase(athleteRow) : null,
            sports,
            aiConsent,
          };
        },
      }),
      ...defineApiRoute(deleteMyAccountRoute()),
    },
  },
});
