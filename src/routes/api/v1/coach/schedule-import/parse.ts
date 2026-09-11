import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import {
  parseScheduleImageInput,
  parseScheduleResultSchema,
} from "@/lib/api/schedule-import-schema";
import { MAX_IMAGE_BYTES, parseScheduleImageUpload } from "@/lib/schedule-import.server";

/**
 * Thin wrapper over the shared `parseScheduleImageUpload` (PRD §3.6,
 * Appendix A "Schedule import"): a `multipart/form-data` upload named
 * `image` (JPEG, PNG or WebP on `blob.type` — 400 `validation_failed`
 * otherwise; iOS transcodes HEIC before upload; 12 MiB cap enforced on the
 * part itself as well as on Content-Length, 413 `payload_too_large`) is transcribed by the AI gateway and answered as
 * SERVER-NORMALIZED rows (day/time as integers, unreadable flags, raw text
 * kept) so the client never ports the parsers. Coach-only (422
 * `unprocessable` "Coach profile not found"). 503 `ai_unavailable` when the
 * gateway is missing or fails; 422 when the reply holds no JSON; an empty
 * `lessons` array is a normal 200 ("No lessons found in that photo."). Not
 * idempotent — a pure read with an AI cost, so it is rate-limited like the
 * voice routes.
 */
export const Route = createFileRoute("/api/v1/coach/schedule-import/parse")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/schedule-import/parse",
      operationId: "parseScheduleImage",
      auth: "user",
      body: "multipart",
      partContentTypes: { image: "image/jpeg" },
      maxBodyBytes: MAX_IMAGE_BYTES,
      rateLimit: { windowSeconds: 60, max: 10 },
      summary: "Transcribe a photo of a lesson schedule into normalized rows",
      input: parseScheduleImageInput,
      output: parseScheduleResultSchema,
      handler: async ({ ctx, input }) => {
        const { admin, userId } = requireContext(ctx);
        return parseScheduleImageUpload({ admin, userId }, input);
      },
    }),
  },
});
