import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { setCoachPhoto, setCoachPhotoInput } from "@/lib/coach-photo.server";

const coachPhotoResultSchema = z.object({
  /** A link to show the photo right away (an hour); null when it was removed. */
  photoUrl: z.string().nullable(),
});

/**
 * Thin wrapper over `setCoachPhoto` in `src/lib/coach-photo.server.ts`: the
 * app uploads to the private coach-photos bucket first, then saves the
 * object's URL here. `null` removes the photo.
 */
export const Route = createFileRoute("/api/v1/coach/profile_/photo")({
  server: {
    handlers: defineApiRoute({
      method: "PUT",
      path: "/api/v1/coach/profile/photo",
      operationId: "setCoachProfilePhoto",
      auth: "user",
      summary: "Set or remove the coach's profile photo",
      input: setCoachPhotoInput,
      output: coachPhotoResultSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase, admin } = requireContext(ctx);
        return setCoachPhoto({ userId, supabase, admin }, input.photo);
      },
    }),
  },
});
