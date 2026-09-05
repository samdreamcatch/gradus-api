import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

const outputSchema = z.object({
  accepted: z.boolean(),
  version: z.string(),
  acceptedAt: z.string().nullable(),
});

/**
 * Same result as `getTermsStatus` in `src/lib/terms.functions.ts`,
 * reproduced through `ctx.admin` rather than imported (per brief).
 */
export const Route = createFileRoute("/api/v1/me/terms")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/me/terms",
      auth: "user",
      summary: "Terms-of-service acceptance status for the caller",
      output: outputSchema,
      handler: async ({ ctx }) => {
        const { admin, userId } = requireContext(ctx);
        const { data, error } = await admin
          .from("terms_acceptances")
          .select("terms_version, accepted_at")
          .eq("user_id", userId)
          .eq("terms_version", CURRENT_TERMS_VERSION)
          .maybeSingle();
        if (error) {
          console.error("[api] me/terms", error);
          throw new ApiError({
            code: "internal",
            status: 500,
            message: "Something went wrong. Please try again.",
          });
        }
        return {
          accepted: !!data,
          version: CURRENT_TERMS_VERSION,
          acceptedAt: data?.accepted_at ?? null,
        };
      },
    }),
  },
});
