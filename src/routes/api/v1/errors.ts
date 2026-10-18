import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { errorReportInput } from "@/lib/api/errors-schema";
import { okSchema } from "@/lib/api/onboarding-schema";
import { parseClientHeader } from "@/lib/api/client";
import { reportAppError } from "@/lib/errors.server";

/**
 * App error intake: iOS errors and MetricKit diagnostics (PRD §6.10, §10.6 P9),
 * and Android errors, crashes and ANRs (docs/android/PRD.md §6.11.8). Public,
 * like the web's `reportClientError`: a crash on the sign-in screen has no
 * session to attach. A bearer token, when present, attributes the row to
 * the caller. Rate-limited (per user when signed in, per address
 * otherwise) so a crash loop cannot flood the table.
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
        return reportAppError(
          {
            clientPlatform: parseClientHeader(request).platform,
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
