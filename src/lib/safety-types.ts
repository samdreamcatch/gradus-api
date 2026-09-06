import { z } from "zod";

export const REPORT_REASONS = [
  "harassment",
  "inappropriate",
  "spam",
  "minor_safety",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harassment: "Harassment or bullying",
  inappropriate: "Inappropriate or sexual content",
  spam: "Spam or scam",
  minor_safety: "Safety concern about a minor",
  other: "Something else",
};

export type ReportStatus = "open" | "reviewed" | "actioned" | "dismissed";

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  open: "Open",
  reviewed: "Reviewed",
  actioned: "Actioned",
  dismissed: "Dismissed",
};

/** Input of `submitReport` (web server function and `POST /api/v1/safety/reports`). */
export const reportInput = z
  .object({
    targetUserId: z.string().uuid().nullish(),
    messageId: z.string().uuid().nullish(),
    resourceId: z.string().uuid().nullish(),
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(2000).default(""),
    alsoBlock: z.boolean().default(true),
  })
  .refine((v) => !!v.targetUserId || !!v.resourceId, {
    message: "Nothing to report",
  });

export type ReportInput = z.infer<typeof reportInput>;

