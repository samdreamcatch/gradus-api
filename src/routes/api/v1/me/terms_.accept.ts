import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

const outputSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  /** True when no profile row exists yet; the client retries after onboarding. */
  deferred: z.boolean(),
});

/**
 * `POST /me/terms/accept` (PRD Appendix A, §6.4 "Terms"). Same result as
 * `acceptTerms` in `src/lib/terms.functions.ts`, reproduced through the
 * caller's user-scoped client so RLS applies exactly as on the web. The
 * role is always derived server-side; the API never accepts one from the
 * client. The upsert ignores duplicates, so the call is naturally
 * idempotent.
 *
 * File is `terms_.accept.ts` (trailing underscore) so it does not nest under
 * the `me/terms.ts` route.
 */
export const Route = createFileRoute("/api/v1/me/terms_/accept")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/me/terms/accept",
      operationId: "postMeTermsAccept",
      auth: "user",
      summary: "Accept the current Terms of Service for the caller",
      output: outputSchema,
      handler: async ({ ctx }) => {
        const { supabase, userId } = requireContext(ctx);
        const [coach, parent, athlete] = await Promise.all([
          supabase.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle(),
          supabase.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
          supabase.from("athletes").select("id").eq("user_id", userId).limit(1).maybeSingle(),
        ]);
        let role: "coach" | "parent" | "athlete" | null = null;
        if (coach.data) role = "coach";
        else if (parent.data) role = "parent";
        else if (athlete.data) role = "athlete";
        if (!role) {
          return { ok: false, version: CURRENT_TERMS_VERSION, deferred: true };
        }

        const { error } = await supabase
          .from("terms_acceptances")
          .upsert(
            { user_id: userId, role, terms_version: CURRENT_TERMS_VERSION },
            { onConflict: "user_id,terms_version", ignoreDuplicates: true },
          );
        if (error) {
          console.error("[api] me/terms/accept", error);
          throw new ApiError({
            code: "internal",
            status: 500,
            message: "Something went wrong. Please try again.",
          });
        }
        return { ok: true, version: CURRENT_TERMS_VERSION, deferred: false };
      },
    }),
  },
});
