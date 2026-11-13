/**
 * Zod schemas for the plans, move library, sessions, sharing, and voice
 * DTOs, mirroring `plans.server.ts`, `moves.server.ts`, `move-draft.server.ts`,
 * `plan-sessions.server.ts`, `parent-plans.server.ts`,
 * `athlete-plans.server.ts`, `plan-share.server.ts`, `plan-detail.server.ts`,
 * and `voice.server.ts` field for field (`satisfies` keeps them honest), so
 * the OpenAPI document and the generated Swift client carry the real shapes.
 */
import { z } from "zod";
import type { SessionsByState } from "@/components/plans/flow-state-bars";
import type {
  AthleteDraftSummaryDTO,
  AthletePlanSummaryDTO,
  AthletePlansDTO,
} from "@/lib/athlete-plans.server";
import type { MoveDraftDTO } from "@/lib/move-draft.server";
import type { ImportMovesResult, MoveDTO, MoveLibraryDTO, NameConflict } from "@/lib/moves.server";
import type { ParentPlanSummaryDTO, ParentPlansDTO } from "@/lib/parent-plans.server";
import type { RoleAwarePlanDetailDTO } from "@/lib/plan-detail.server";
import type {
  PlanSessionLogDTO,
  PlanSessionsSummaryDTO,
  SessionCounts,
} from "@/lib/plan-sessions.server";
import type { SharedPlanDTO } from "@/lib/plan-share.server";
import type { LibraryMoveSnapshotDTO, PlanMoveDTO, PlanSummaryDTO } from "@/lib/plans.server";
import type { ApplyResult } from "@/lib/voice.server";
import type { FieldSource, VoiceSources, VoiceTouched } from "@/lib/voice-types";
import { binaryPart } from "./openapi";

export const planKindSchema = z.enum(["plan", "template"]);
export const planStatusSchema = z.enum(["active", "benched", "draft"]);
export const targetKindSchema = z.enum(["reps", "mins"]);

export const sessionsByStateSchema = z.object({
  frustrated: z.number().int(),
  pushing: z.number().int(),
  steady: z.number().int(),
  lockedIn: z.number().int(),
  flowing: z.number().int(),
}) satisfies z.ZodType<SessionsByState>;

export const sessionCountsSchema = z.object({
  sessionsByState: sessionsByStateSchema,
  sessionsTotal: z.number().int(),
}) satisfies z.ZodType<SessionCounts>;

/* ---------------- coach plans ---------------- */

export const libraryMoveSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  cue: z.string(),
  why: z.string(),
  defaultTargetKind: targetKindSchema,
  defaultTargetValue: z.number(),
}) satisfies z.ZodType<LibraryMoveSnapshotDTO>;

export const planMoveSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  moveId: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  cue: z.string(),
  why: z.string(),
  targetKind: targetKindSchema,
  targetValue: z.number(),
  libraryMove: libraryMoveSnapshotSchema.nullable(),
}) satisfies z.ZodType<PlanMoveDTO>;

export const planSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: planKindSchema,
  status: planStatusSchema,
  athleteId: z.string().nullable(),
  athleteName: z.string().nullable(),
  moveCount: z.number().int(),
  totalMinutes: z.number(),
  updatedAt: z.string(),
  sessionsByState: sessionsByStateSchema,
  sessionsTotal: z.number().int(),
  // One plan for several athletes (PRD decision #66). Both optional, so an
  // installed client never fails to decode a server that predates them.
  sharedCount: z
    .number()
    .int()
    .optional()
    .describe(
      "On a plan given to several athletes: how many have a copy. Its session counts are the copies', summed.",
    ),
  sharedFromId: z
    .string()
    .optional()
    .describe("On one athlete's copy: the plan it was copied from."),
}) satisfies z.ZodType<PlanSummaryDTO>;

/** One athlete's copy of a plan the coach gave to several athletes (decision #66). */
export const planShareSchema = z.object({
  athleteId: z.string(),
  name: z.string(),
  planId: z.string().describe("That athlete's own copy: an ordinary plan the coach can open."),
  status: z.string().describe("The copy's status: active, benched, or draft. A plain string."),
  sessionsTotal: z.number().int(),
  tailored: z
    .boolean()
    .describe(
      "The coach changed this copy on its own, so sending it an update replaces those edits.",
    ),
  behind: z.boolean().describe("The plan has changes this copy has not received."),
});

/** One line of what changed since the copies last received the plan. */
export const pendingChangeSchema = z.object({
  planMoveId: z
    .string()
    .nullable()
    .describe("The plan's move; null for a removed move or a change to the plan itself."),
  name: z.string().describe("The move's name; empty for a change to the plan itself."),
  change: z
    .string()
    .describe(
      "A plain string, never an enum: new, minutes, reps, changed, removed, title, notes, feedback, or order.",
    ),
});

export const sharedPlanCopiesSchema = z.object({
  id: z.string().describe("The plan the coach keeps editing; its sharedWith lists the copies."),
  shared: z.number().int().describe("How many athletes now have a copy."),
});
export const updatedPlanCopiesSchema = z.object({
  ok: z.literal(true),
  updated: z.number().int().describe("How many copies actually changed."),
});

export const planListSchema = z.object({ plans: z.array(planSummarySchema) });

export const planCoachSchema = z.object({
  id: z.string(),
  name: z.string(),
  firstName: z.string(),
  isGradus: z.boolean(),
});

export const planDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string(),
  kind: planKindSchema,
  status: planStatusSchema,
  athleteId: z.string().nullable(),
  athleteName: z.string().nullable(),
  athleteFirstName: z.string().nullable(),
  coach: planCoachSchema.nullable(),
  viewerRole: z.enum(["coach", "parent", "athlete"]),
  isOwner: z.boolean(),
  moveCount: z.number().int(),
  totalMinutes: z.number(),
  updatedAt: z.string(),
  moves: z.array(planMoveSchema),
  voiceTranscript: z.string().nullable(),
  sessionsByState: sessionsByStateSchema,
  sessionsTotal: z.number().int(),
  // A plan an athlete wrote (PRD §6.14): `source` is a plain string, never an
  // enum, and both fields are optional, so an installed client never fails to
  // decode a server that predates them.
  source: z.string().optional(),
  authorFirstName: z.string().nullable().optional(),
  // "plan" (one rating for the session) or "moves" (a rating per move; the
  // session's rating is their average). Optional for older clients and servers.
  feedbackScope: z.string().optional(),
  // One plan for several athletes (PRD decision #66). All optional.
  sharedCount: z.number().int().optional(),
  sharedFromId: z.string().optional(),
  sharedWith: z
    .array(planShareSchema)
    .optional()
    .describe("Owning coach only: the athletes who each have a copy of this plan."),
  pendingChanges: z
    .array(pendingChangeSchema)
    .optional()
    .describe("With sharedWith: what changed since the copies last received this plan."),
  updatedMoves: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Parent and athlete only: what the coach's last update changed on this plan, as plan move id to new, minutes, reps, or changed. Sent until practice is next logged on the plan.",
    ),
}) satisfies z.ZodType<RoleAwarePlanDetailDTO>;

export const planIdSchema = z.object({ id: z.string() });
export const activePlansSchema = z.object({
  plans: z.array(z.object({ id: z.string(), title: z.string() })),
});
export const updatePlanResultSchema = z.object({
  ok: z.literal(true),
  forkedId: z.string().optional(),
});
export const addMoveResultSchema = z.object({ planId: z.string(), planTitle: z.string() });
export const insertedSchema = z.object({ inserted: z.number().int() });

/* ---------------- move library ---------------- */

export const moveSchema = z.object({
  id: z.string(),
  sport: z.string(),
  category: z.string(),
  name: z.string(),
  description: z.string(),
  cue: z.string(),
  why: z.string(),
  defaultTargetKind: targetKindSchema,
  defaultTargetValue: z.number(),
}) satisfies z.ZodType<MoveDTO>;

export const moveLibrarySchema = z.object({
  moves: z.array(moveSchema),
  seedCategories: z.array(z.object({ sport: z.string(), category: z.string() })),
}) satisfies z.ZodType<MoveLibraryDTO>;

export const nameConflictSchema = z.object({
  existingMoveId: z.string(),
  name: z.string(),
}) satisfies z.ZodType<NameConflict>;

/** `ok: false` carries the same-named move so the client can offer to overwrite it. */
export const upsertMoveResultSchema = z.object({
  ok: z.boolean(),
  move: moveSchema.optional(),
  conflict: nameConflictSchema.optional(),
});

export const importMovesResultSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int(),
      name: z.string(),
      status: z.enum(["created", "updated", "skipped"]),
      reason: z.enum(["name_exists", "duplicate_in_file"]).optional(),
      moveId: z.string().optional(),
    }),
  ),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
}) satisfies z.ZodType<ImportMovesResult>;

export const libraryLinkResultSchema = z.object({
  ok: z.boolean(),
  moveId: z.string().optional(),
  conflict: nameConflictSchema.optional(),
});

export const moveIdSchema = z.object({ moveId: z.string() });

/**
 * AI suggestions for a new move (decision #53); `category` only when the
 * request had none. "unsure" and "unknown" answer with empty description,
 * cue and why. `source`, `sourceName` and `understoodAs` are for logs and
 * evals; the apps don't show them.
 */
export const moveDraftSchema = z.object({
  description: z.string(),
  cue: z.string(),
  why: z.string(),
  category: z.string().optional(),
  source: z.enum(["gradus_library", "exercise_list", "ai"]).optional(),
  sourceName: z.string().optional(),
  recognition: z.enum(["known", "unsure", "unknown"]).optional(),
  understoodAs: z.string().optional(),
}) satisfies z.ZodType<MoveDraftDTO>;

/* ---------------- parent and athlete plans ---------------- */

export const parentPlanSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["active", "benched"]),
  athleteId: z.string(),
  athleteName: z.string(),
  coachId: z.string(),
  coachName: z.string(),
  isGradus: z.boolean(),
  moveCount: z.number().int(),
  totalMinutes: z.number(),
  updatedAt: z.string(),
  sessionsByState: sessionsByStateSchema,
  sessionsTotal: z.number().int(),
  source: z.string().optional(),
}) satisfies z.ZodType<ParentPlanSummaryDTO>;

export const parentPlansSchema = z.object({
  athletes: z.array(z.object({ id: z.string(), name: z.string(), locked: z.boolean() })),
  plans: z.array(parentPlanSummarySchema),
}) satisfies z.ZodType<ParentPlansDTO>;

export const parentPlansQuery = z.object({
  status: z.enum(["active", "benched"]).optional(),
  coachId: z.string().uuid().optional(),
  athleteId: z.string().uuid().optional(),
});

export const athletePlanSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["active", "benched"]),
  coachId: z.string(),
  coachName: z.string(),
  isGradus: z.boolean(),
  sport: z.string(),
  moveCount: z.number().int(),
  totalMinutes: z.number(),
  updatedAt: z.string(),
  sessionsByState: sessionsByStateSchema,
  sessionsTotal: z.number().int(),
  /** `"athlete"` marks a plan the athlete wrote (never captioned "from Gradus"). */
  source: z.string().optional(),
}) satisfies z.ZodType<AthletePlanSummaryDTO>;

/** An unfinished plan the athlete wrote; its own type so the closed `status` enum above never gains a value. */
export const athleteDraftSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.literal("draft"),
  source: z.string(),
  moveCount: z.number().int(),
  totalMinutes: z.number(),
  updatedAt: z.string(),
}) satisfies z.ZodType<AthleteDraftSummaryDTO>;

export const athletePlansSchema = z.object({
  athlete: z.object({ id: z.string(), firstName: z.string() }),
  plans: z.array(athletePlanSummarySchema),
  drafts: z.array(athleteDraftSummarySchema).optional(),
}) satisfies z.ZodType<AthletePlansDTO>;

/* ---------------- sessions ---------------- */

export const planSessionEntrySchema = z.object({
  id: z.string(),
  loggedAt: z.string(),
  durationSeconds: z.number().int(),
  stateIndex: z.number().int(),
  note: z.string(),
  loggedByKind: z.enum(["parent", "athlete"]),
  loggedByFirstName: z.string(),
  // Feedback on each move (2026-10-14). Optional, and `feedbackScope` a plain
  // string, so an installed client never fails to decode a newer server.
  feedbackScope: z.string().optional(),
  moveRatings: z
    .array(
      z.object({
        planMoveId: z.string().nullable(),
        moveName: z.string(),
        stateIndex: z.number().int(),
      }),
    )
    .optional(),
});

export const planSessionLogSchema = z.object({
  sessions: z.array(planSessionEntrySchema),
  athleteFirstName: z.string(),
  loggedByAthlete: z.number().int(),
  loggedByParent: z.number().int(),
  total: z.number().int(),
}) satisfies z.ZodType<PlanSessionLogDTO>;

export const planSessionsSummarySchema = z.object({
  summary: z.string(),
  generatedAt: z.string(),
  empty: z.boolean(),
  sessionsTotal: z.number().int(),
}) satisfies z.ZodType<PlanSessionsSummaryDTO>;

export const submitSessionResultSchema = z.object({
  ok: z.literal(true),
  loggedAs: z.enum(["parent", "athlete"]),
});

/* ---------------- sharing ---------------- */

export const sharedPlanSchema = z.object({
  title: z.string(),
  notes: z.string(),
  coachFirstName: z.string(),
  coachLastName: z.string(),
  sharedAt: z.string().nullable(),
  moves: z.array(
    z.object({
      position: z.number().int(),
      name: z.string(),
      description: z.string(),
      cue: z.string(),
      why: z.string(),
      targetKind: targetKindSchema,
      targetValue: z.number(),
    }),
  ),
  // Who wrote it (PRD §6.14 D): "coach" or "athlete" as a plain string, and that
  // author's first name. Optional so an older database or client still works;
  // absent means a coach.
  authorKind: z.string().optional(),
  authorFirstName: z.string().optional(),
}) satisfies z.ZodType<SharedPlanDTO>;

export const shareTokenSchema = z.object({ token: z.string() });
export const importedPlanSchema = z.object({ planId: z.string() });

/* ---------------- voice ---------------- */

export const voiceTranscribeInput = z.object({ audio: binaryPart });

/** `planId` is required when `mode` is `edit`; the route checks it (a refinement would hide the object shape from the generator). */
export const voiceBuildInput = z.object({
  audio: binaryPart,
  mode: z.enum(["create", "edit"]),
  planId: z.string().uuid().optional(),
});

export const transcriptSchema = z.object({ text: z.string() });

const fieldSourceSchema = z.object({
  quote: z.string(),
  start: z.number().int(),
  end: z.number().int(),
}) satisfies z.ZodType<FieldSource>;

const moveFieldSourcesSchema = z.object({
  name: fieldSourceSchema.optional(),
  description: fieldSourceSchema.optional(),
  cue: fieldSourceSchema.optional(),
  why: fieldSourceSchema.optional(),
  target: fieldSourceSchema.optional(),
});

export const voiceSourcesSchema = z.object({
  plan: z
    .object({
      title: fieldSourceSchema.optional(),
      athleteId: fieldSourceSchema.optional(),
      notes: fieldSourceSchema.optional(),
    })
    .optional(),
  moves: z.record(z.string(), moveFieldSourcesSchema).optional(),
}) satisfies z.ZodType<VoiceSources>;

export const voiceTouchedSchema = z.object({
  plan: z.object({
    title: z.boolean().optional(),
    athleteId: z.boolean().optional(),
    notes: z.boolean().optional(),
  }),
  moves: z.record(z.string(), z.array(z.string())),
  newMoveIds: z.array(z.string()),
  transcript: z.string().optional(),
  sources: voiceSourcesSchema.optional(),
}) satisfies z.ZodType<VoiceTouched>;

export const voiceApplyResultSchema = z.object({
  planId: z.string(),
  transcript: z.string(),
  touched: voiceTouchedSchema,
  unresolvedAthleteName: z.string().nullable(),
  appliedMoveCount: z.number().int(),
  droppedMoveCount: z.number().int(),
  aiFailed: z.boolean(),
}) satisfies z.ZodType<ApplyResult>;
