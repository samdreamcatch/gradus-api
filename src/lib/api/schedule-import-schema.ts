/**
 * Zod schemas for the schedule-import DTOs, mirroring
 * `schedule-import.server.ts` field for field (`satisfies` keeps them
 * honest). PRD §3.6, Appendix A "Schedule import". Plain objects with
 * nullable fields only — no unions (Swift codegen, handoff §5).
 */
import { z } from "zod";
import type {
  CommitScheduleImportResultDTO,
  ImportOutcomeDTO,
  NormalizedLessonDTO,
  ParseScheduleResultDTO,
} from "@/lib/schedule-import.server";
import { binaryPart } from "./openapi";
import { lessonFrequencySchema } from "./roster-schema";

/** `POST /coach/schedule-import/parse` multipart body: the photo as the `image` part. */
export const parseScheduleImageInput = z.object({ image: binaryPart });

export const parsedLessonSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  startMinute: z.number().int().min(0).max(1439).nullable(),
  lengthMinutes: z.number(),
  frequency: lessonFrequencySchema,
  guardianEmail: z.string().nullable(),
  athleteEmail: z.string().nullable(),
  rawDay: z.string(),
  rawStartTime: z.string(),
  dayUnreadable: z.boolean(),
  startTimeUnreadable: z.boolean(),
}) satisfies z.ZodType<NormalizedLessonDTO>;

export const parseScheduleResultSchema = z.object({
  lessons: z.array(parsedLessonSchema),
}) satisfies z.ZodType<ParseScheduleResultDTO>;

export const importOutcomeStatusSchema = z.enum(["created", "linked", "failed", "skipped"]);
export const importOutcomeReasonSchema = z.enum([
  "roster_full",
  "ends_before_start",
  "link_failed",
]);

export const importOutcomeSchema = z.object({
  key: z.string(),
  name: z.string(),
  status: importOutcomeStatusSchema,
  slotsAdded: z.number().int(),
  invited: z.string().nullable(),
  message: z.string().nullable(),
  reason: importOutcomeReasonSchema.nullable(),
  limit: z.number().int().nullable(),
}) satisfies z.ZodType<ImportOutcomeDTO>;

export const commitScheduleImportResultSchema = z.object({
  outcomes: z.array(importOutcomeSchema),
}) satisfies z.ZodType<CommitScheduleImportResultDTO>;
