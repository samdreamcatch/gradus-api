import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { uploadUrlSchema } from "@/lib/api/resources-schema";
import {
  createCoachResourceUploadUrl,
  createCoachResourceUploadUrlInput,
} from "@/lib/coach-resources.server";

/**
 * Thin wrapper over the shared `createCoachResourceUploadUrl`
 * (PRD §7.9, Appendix A "Resources and Ask Gradus"). Not idempotent by
 * design: every call mints a fresh signed upload URL and storage path.
 */
export const Route = createFileRoute("/api/v1/coach/resources/upload-url")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/resources/upload-url",
      operationId: "createCoachResourceUploadUrl",
      auth: "user",
      summary: "Mint a signed upload URL for a new coach resource file",
      input: createCoachResourceUploadUrlInput,
      output: uploadUrlSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase } = requireContext(ctx);
        return createCoachResourceUploadUrl({ userId, supabase }, input);
      },
    }),
  },
});
