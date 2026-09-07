import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { deleteMyAccountRoute } from "@/lib/api/account-routes";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

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
});

/**
 * Minimal `GET /me` (PRD Appendix A): role, onboarding state, and terms
 * status, which is what the iOS app shell needs to pick the tab bar and the
 * blocking terms sheet (milestone I1). It grows into the full composite
 * (profile summary, entitlement, guardian status, flags, unread count, ETag)
 * in B3 by adding fields, never changing these.
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
          const [coach, parent, athlete, orgAdmin, terms] = await Promise.all([
            admin
              .from("coach_profiles")
              .select("id, onboarded_at")
              .eq("user_id", userId)
              .maybeSingle(),
            admin.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
            admin.from("athletes").select("id").eq("user_id", userId).limit(1).maybeSingle(),
            admin.from("org_admins").select("id").eq("user_id", userId).limit(1).maybeSingle(),
            admin
              .from("terms_acceptances")
              .select("terms_version, accepted_at")
              .eq("user_id", userId)
              .eq("terms_version", CURRENT_TERMS_VERSION)
              .maybeSingle(),
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

          return {
            userId,
            role,
            onboardingComplete,
            terms: {
              accepted: !!terms.data,
              version: CURRENT_TERMS_VERSION,
              acceptedAt: terms.data?.accepted_at ?? null,
            },
          };
        },
      }),
      ...defineApiRoute(deleteMyAccountRoute()),
    },
  },
});
