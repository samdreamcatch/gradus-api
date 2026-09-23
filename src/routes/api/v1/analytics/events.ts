import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import {
  analyticsBatchInput,
  recordAnalyticsBatch,
  type AnalyticsDb,
} from "@/lib/analytics.server";

/**
 * `POST /api/v1/analytics/events` (PRD §6.12, milestone A1): a batch of up
 * to 100 usage events from the iOS app. Authenticated; who the caller is
 * (role, age band, minor de-identification, club and region) is derived
 * server-side in `recordAnalyticsBatch`, never taken from the body. Event ids
 * are the primary key, so a retried batch is a no-op; the body is capped at
 * 64 KB and the route is rate-limited.
 */
export const Route = createFileRoute("/api/v1/analytics/events")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/analytics/events",
      operationId: "recordAnalyticsEvents",
      auth: "user",
      rateLimit: { windowSeconds: 60, max: 30 },
      maxBodyBytes: 64 * 1024,
      summary: "Record a batch of usage analytics events",
      input: analyticsBatchInput,
      output: z.object({ accepted: z.number().int() }),
      handler: async ({ ctx, input }) => {
        const { userId, admin } = requireContext(ctx);
        // The loose shape the analytics tables need (not yet in the generated types).
        return recordAnalyticsBatch(admin as unknown as AnalyticsDb, userId, input);
      },
    }),
  },
});
