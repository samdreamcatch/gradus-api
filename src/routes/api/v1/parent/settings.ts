import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { defineApiRoute, weakETag } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { parentSettingsSchema } from "@/lib/api/parent-settings-schema";
import { getParentSettings } from "@/lib/parent-settings.server";

/**
 * Thin wrapper over the shared `getParentSettings` (PRD §7.7, Appendix A
 * `[etag]`): the parent's name and every athlete with coaches, sports,
 * goals, and per-coach schedules. The validator is a digest of the body,
 * so `If-None-Match` answers 304 while nothing changed.
 */
export const Route = createFileRoute("/api/v1/parent/settings")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/parent/settings",
      operationId: "getParentSettings",
      auth: "user",
      summary: "The parent's settings snapshot",
      output: parentSettingsSchema,
      etag: (settings) =>
        weakETag([
          "parent-settings",
          createHash("sha256").update(JSON.stringify(settings)).digest("hex").slice(0, 16),
        ]),
      handler: async ({ ctx }) => {
        const { userId, admin } = requireContext(ctx);
        return getParentSettings({ userId, admin });
      },
    }),
  },
});
