import { z } from "zod";

/**
 * `POST /api/v1/errors` (PRD §6.10 "Error reporting", §10.6 P9): a caught
 * error, a MetricKit crash, or a hang from the iOS app. Mirrors the web's
 * `reportClientError` input, plus what the admin errors dashboard needs to
 * tell platforms apart: the app version and build, the OS, the device.
 */
export const errorReportInput = z.object({
  message: z.string().min(1).max(4000),
  stack: z.string().max(16000).optional().nullable(),
  /** The screen or route the error happened on (`AppRoute` description). */
  route: z.string().max(1000).optional().nullable(),
  kind: z.enum(["error", "crash", "hang"]).default("error"),
  appVersion: z.string().max(32),
  build: z.string().max(32),
  osVersion: z.string().max(32).optional().nullable(),
  device: z.string().max(64).optional().nullable(),
  /** When the error happened on the device (MetricKit diagnostics arrive on the next launch). */
  occurredAt: z.string().datetime({ offset: true }).optional().nullable(),
  metadata: z
    .record(z.unknown())
    .optional()
    // A public route: the app sends a few short strings, so anything large is not ours.
    .refine((m) => !m || JSON.stringify(m).length <= 8_000, "metadata too large"),
});

export type ErrorReportInput = z.infer<typeof errorReportInput>;
