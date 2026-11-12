/**
 * Plan report reasons, inputs and shapes, shared by the API, the admin server
 * functions and their callers (no server-only imports).
 */
import { z } from "zod";

export const PLAN_REPORT_REASONS = ["inappropriate", "misleading", "unsafe"] as const;
export type PlanReportReason = (typeof PLAN_REPORT_REASONS)[number];

/** The app's labels for each reason ("What's wrong"). */
export const PLAN_REPORT_REASON_LABELS: Record<PlanReportReason, string> = {
  inappropriate: "Inappropriate content",
  misleading: "Misleading listing",
  unsafe: "Unsafe instruction",
};

export const reportPlanInput = z.object({
  reason: z.enum(PLAN_REPORT_REASONS),
  /** Optional: anything else the reporter wants us to know. */
  note: z.string().trim().max(2000).default(""),
});

export const PLAN_REPORT_STATUSES = ["open", "reviewed", "actioned", "dismissed"] as const;
export type PlanReportStatus = (typeof PLAN_REPORT_STATUSES)[number];

export interface PlanReportDTO {
  id: string;
  /** Null once the plan was deleted; `planTitle` keeps what was reported. */
  planId: string | null;
  planTitle: string;
  coachId: string | null;
  coachName: string | null;
  reporter: { userId: string; name: string; role: string };
  reason: PlanReportReason;
  note: string;
  status: PlanReportStatus;
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
}

export const listPlanReportsInput = z.object({
  openOnly: z.boolean().default(false),
});

export const updatePlanReportInput = z.object({
  id: z.string().uuid(),
  status: z.enum(PLAN_REPORT_STATUSES),
  adminNotes: z.string().max(2000).optional(),
});
