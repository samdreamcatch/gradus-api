import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { errorReportInput } from "@/lib/api/errors-schema";
import { okSchema } from "@/lib/api/onboarding-schema";
import { reportIosError } from "@/lib/errors.server";

/**
 * iOS error and MetricKit diagnostic intake (PRD §6.10, §10.6 P9). Public,
 * like the web's `reportClientError`: a crash on the sign-in screen has no
 * session to attach. A bearer token, when present, attributes the row to
 * the caller. Rate-limited per address so a crash loop cannot flood the
 * table.
 */
export const Route = createFileRoute("/api/v1/errors")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/errors",
      operationId: "reportError",
      auth: "public",
      rateLimit: { windowSeconds: 60, max: 30 },
      summary: "Report an app error or MetricKit diagnostic",
      input: errorReportInput,
      output: okSchema,
      handler: async ({ ctx, input, request }) => {
        return reportIosError(
          {
            userId: ctx?.userId ?? null,
            userAgent: request.headers.get("user-agent"),
            host: request.headers.get("host"),
          },
          input,
        );
      },
    }),
  },
});
