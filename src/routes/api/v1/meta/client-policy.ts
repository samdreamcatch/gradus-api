import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";

const outputSchema = z.object({
  minSupportedVersion: z.object({ ios: z.string() }),
  message: z.string().nullable(),
});

// Constants for now — no forced-update rollout has shipped yet. When one
// does, this becomes a lookup (config table or env var) instead of a literal.
export const Route = createFileRoute("/api/v1/meta/client-policy")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/meta/client-policy",
      auth: "public",
      summary: "Minimum supported client version and force-update message",
      output: outputSchema,
      handler: async () => ({
        minSupportedVersion: { ios: "0.0.0" },
        message: null,
      }),
    }),
  },
});
