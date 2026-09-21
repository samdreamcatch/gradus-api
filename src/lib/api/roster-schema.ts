/**
 * Zod schemas for the coach roster and schedule DTOs, mirroring
 * `coach-roster.server.ts`, `coach-athlete-detail.server.ts`,
 * `pre-lesson-briefing.server.ts`, and `lesson-wrap-ups.server.ts` field for
 * field (`satisfies` keeps them honest), so the OpenAPI document and the
 * generated Swift client carry the real shapes.
 */
import { z } from "zod";
import type {
  AddAthleteResult,
  AthletePracticeSummary,
  CoachRoster,
} from "@/lib/coach-roster.server";
import type {
  CoachAthleteAiSummaryDTO,
  CoachAthleteDetailDTO,
  OtherCoachPlanForMessageDTO,
} from "@/lib/coach-athlete-detail.server";
import type { PreLessonBriefing } from "@/lib/pre-lesson-briefing.server";
import type { PendingWrapUp } from "@/lib/lesson-wrap-ups.server";

export const lessonFrequencySchema = z.enum(["weekly", "biweekly", "twice_monthly", "monthly"]);

export const rosterSlotSchema = z.object({
  id: z.string(),
  dayOfWeek: z.number().int(),
  startMinute: z.number().int(),
  endMinute: z.number().int(),
  frequency: lessonFrequencySchema,
  weeksOfMonth: z.array(z.number().int()),
  startsOn: z.string().nullable(),
  overrides: z.array(
    z.object({
      date: z.string(),
      status: z.enum(["canceled", "rescheduled"]),
      startMinute: z.number().int().nullable(),
      endMinute: z.number().int().nullable(),
    }),
  ),
});

export const rosterAthleteSchema = z.object({
  athleteId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  sport: z.string().nullable(),
  parentFirstName: z.string().nullable(),
  parentLastName: z.string().nullable(),
  selfManaged: z.boolean(),
  slots: z.array(rosterSlotSchema),
  otherCoachCount: z.number().int(),
  otherCoachLastName: z.string().nullable(),
});

export const coachRosterSchema = z.object({
  coachSports: z.array(z.string()),
  athletes: z.array(rosterAthleteSchema),
}) satisfies z.ZodType<CoachRoster>;

export const practiceSummarySchema = z.object({
  athleteId: z.string(),
  hoursLogged: z.number(),
  expectedHoursPerWeek: z.number().nullable(),
  seasonGoalLabel: z.string().nullable(),
  sessionStates: z.array(z.number().int()),
  sessionCount: z.number().int(),
  windowDays: z.number().int(),
}) satisfies z.ZodType<AthletePracticeSummary>;

export const practiceSummariesSchema = z.object({ summaries: z.array(practiceSummarySchema) });

export const addAthleteResultSchema = z.object({
  athleteId: z.string(),
  guardianEmail: z.string().nullable(),
}) satisfies z.ZodType<AddAthleteResult>;

export const slotIdSchema = z.object({ id: z.string() });

const planStatusSchema = z.enum(["active", "benched"]);
const sessionsByStateSchema = z.object({
  frustrated: z.number().int(),
  pushing: z.number().int(),
  steady: z.number().int(),
  lockedIn: z.number().int(),
  flowing: z.number().int(),
});
const coachedSportSchema = z.object({ key: z.string(), label: z.string() });
const otherCoachMoveSchema = z.object({
  position: z.number().int(),
  name: z.string(),
  description: z.string(),
  cue: z.string(),
  why: z.string(),
  targetKind: z.enum(["reps", "mins"]),
  targetValue: z.number(),
});
const otherCoachPlanSchema = z.object({
  planId: z.string(),
  title: z.string(),
  status: planStatusSchema,
  updatedAt: z.string(),
  sessionsLast30d: z.number().int(),
  notes: z.string(),
  moves: z.array(otherCoachMoveSchema),
});
export const otherCoachSchema = z.object({
  coachId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  sports: z.array(coachedSportSchema),
  activeCount: z.number().int(),
  benchedCount: z.number().int(),
  plans: z.array(otherCoachPlanSchema),
});

export const athleteDetailSchema = z.object({
  athleteId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  parentFirstName: z.string().nullable(),
  parentLastName: z.string().nullable(),
  selfManaged: z.boolean(),
  coachedSports: z.array(coachedSportSchema),
  goals: z.array(
    z.object({
      sport: z.string(),
      sportLabel: z.string(),
      currentLevelLabel: z.string(),
      seasonGoalLabel: z.string(),
      longTermGoal: z.string(),
      lastSetBy: z.object({ role: z.enum(["parent", "athlete"]), at: z.string() }).nullable(),
      differsFrom: z
        .object({
          role: z.enum(["parent", "athlete"]),
          at: z.string(),
          currentLevelLabel: z.string(),
          seasonGoalLabel: z.string(),
          longTermGoal: z.string(),
        })
        .nullable(),
    }),
  ),
  practiceTargets: z.array(
    z.object({
      sport: z.string(),
      sportLabel: z.string(),
      currentLevelLabel: z.string().nullable(),
      defaultHoursPerWeek: z.number(),
      hoursPerWeek: z.number(),
      isOverride: z.boolean(),
    }),
  ),
  plans: z.array(
    z.object({
      planId: z.string(),
      title: z.string(),
      status: planStatusSchema,
      isGradus: z.boolean(),
      sessionsByState: sessionsByStateSchema,
      sessionsTotal: z.number().int(),
    }),
  ),
  activity: z.object({
    practiceMinutesMine: z.number().int(),
    practiceMinutesTotal: z.number().int(),
    lessonMinutesTotal: z.number().int(),
  }),
  hasAnySignal: z.boolean(),
  windowDays: z.number().int(),
  otherCoaches: z.array(otherCoachSchema),
  sharedCoachIds: z.array(z.string()),
  coachVisibility: z.record(z.string(), z.enum(["pending", "declined", "accepted"])),
}) satisfies z.ZodType<CoachAthleteDetailDTO>;

export const aiSummarySchema = z.object({
  summary: z.string(),
  verdict: z.enum(["increase", "hold", "reduce"]),
  rationale: z.string(),
  generatedAt: z.string(),
  empty: z.boolean(),
}) satisfies z.ZodType<CoachAthleteAiSummaryDTO>;

export const otherCoachPlanForMessageSchema = z.object({
  coach: otherCoachSchema,
  athleteFirstName: z.string(),
}) satisfies z.ZodType<OtherCoachPlanForMessageDTO>;

export const briefingSchema = z.object({
  narrative: z.string(),
  generatedAt: z.string(),
  fromCache: z.boolean(),
}) satisfies z.ZodType<PreLessonBriefing>;

export const pendingWrapUpSchema = z.object({
  athleteId: z.string(),
  athleteName: z.string(),
  lessonDate: z.string(),
  lessonEndMinute: z.number().int(),
  activePlanId: z.string().nullable(),
}) satisfies z.ZodType<PendingWrapUp>;

export const pendingWrapUpsSchema = z.object({ wrapUps: z.array(pendingWrapUpSchema) });
