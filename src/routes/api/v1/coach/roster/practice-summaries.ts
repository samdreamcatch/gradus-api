import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { practiceSummariesSchema } from "@/lib/api/roster-schema";
import { getRosterPracticeSummaries } from "@/lib/coach-roster.server";

/** Thin wrapper over the shared `getRosterPracticeSummaries`: the last 7 days of practice per rostered athlete. */
export const Route = createFileRoute("/api/v1/coach/roster/practice-summaries")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/coach/roster/practice-summaries",
      auth: "user",
      summary: "Practice logged per athlete over the last week",
      output: practiceSummariesSchema,
      handler: async ({ ctx }) => {
        const { userId, admin } = requireContext(ctx);
        return { summaries: await getRosterPracticeSummaries({ userId, admin }) };
      },
    }),
  },
});
