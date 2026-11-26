/**
 * Coach schedule import (PRD §3.6 / work packages 3.6–3.7, Appendix A
 * "Schedule import"): a photo of a lesson schedule is transcribed by the AI
 * gateway into raw rows, and a reviewed set of athletes + lesson slots is
 * committed onto the coach's roster.
 *
 * Single source of truth for `schedule-import.functions.ts` and the
 * `/api/v1/coach/schedule-import/*` routes. Extracted without behavior
 * changes; the web wrapper turns `ApiError`s back into their original plain
 * messages via `rethrowPlain`. Two things are API-only and composed by the
 * routes, never by the web wrapper:
 *
 * - `parseScheduleImageUpload` adds the coach-profile check and the MIME
 *   allowlist on top of the raw parse, then returns SERVER-NORMALIZED rows
 *   (`normalizeParsedLessons`) so iOS never ports the TypeScript parsers.
 *   The web keeps its raw `{ lessons: ParsedLesson[] }` shape.
 * - `commitScheduleImport` outcomes carry the additive `reason` / `limit`
 *   fields so a client can own the roster-cap copy (PRD §6.8) instead of
 *   echoing the server's `message`, which stays verbatim for the web.
 *
 * Guardian claim tokens are bearer secrets: never log them, never put them
 * in an `ApiError.details` or a rate-limit key.
 */
import { z } from "zod";
import { generateText } from "ai";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { athleteLimitForTier, computeEffectiveTier } from "./coach-profile-types";
import { dbError } from "./db-error";
import { slotsCoincide } from "./lesson-group-guard.server";
import { applyCoachStartingLevels } from "./goals-history.server";
import type { LessonFrequency } from "./lesson-recurrence";
import { isRosterFullError } from "./roster-limits";
import { refineStartingLevels, startingLevelKeySchema, startingLevelsOf } from "./starting-levels";
import { parseDay, parseFrequency, parseTimeToMinutes } from "./schedule-import";

type Admin = typeof supabaseAdmin;

export type ScheduleImportContext = { userId: string; admin: Admin };

/**
 * API-only strictness (PRD §6.2 stable codes). The web wrappers leave this
 * off and keep their original behavior, per PRD §4.1 rule 1. Reserved for
 * this domain: commit has no API-only branch today; the field exists so the
 * routes and the web wrapper stay distinguishable.
 */
export type ScheduleImportOptions = { apiContract?: boolean };

const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const aiUnavailable = (message: string) =>
  new ApiError({ code: "ai_unavailable", status: 503, message });
const validationFailed = (message: string) =>
  new ApiError({ code: "validation_failed", status: 400, message });

/* ------------------------------------------------------------------ DTOs */

/** One raw row as the model transcribed it (day/time/frequency are free text). */
export type ParsedLesson = {
  firstName: string;
  lastName: string;
  day: string;
  startTime: string;
  lengthMinutes: number | null;
  frequency: string;
  guardianEmail: string | null;
  athleteEmail: string | null;
};

export type ImportFrequency = LessonFrequency;

/**
 * One parsed row after server-side normalization — what the API returns so
 * a client never re-implements `parseDay` / `parseTimeToMinutes`. Raw text
 * is kept for display; the `*Unreadable` flags mean "something was written
 * but we couldn't read it", so the client asks instead of silently defaulting.
 */
export interface NormalizedLessonDTO {
  firstName: string;
  lastName: string;
  /** 0 = Sunday … 6 = Saturday; null when unreadable or absent. */
  dayOfWeek: number | null;
  /** Minutes after midnight (0–1439); null when unreadable or absent. */
  startMinute: number | null;
  /** Defaults to 60 when the model gave nothing usable. */
  lengthMinutes: number;
  frequency: ImportFrequency;
  guardianEmail: string | null;
  athleteEmail: string | null;
  rawDay: string;
  rawStartTime: string;
  dayUnreadable: boolean;
  startTimeUnreadable: boolean;
}

export interface ParseScheduleResultDTO {
  lessons: NormalizedLessonDTO[];
}

export type ImportOutcomeStatus = "created" | "linked" | "failed" | "skipped";

/**
 * Why an athlete was skipped or failed, for clients that own the copy:
 * `roster_full` (the plan cap — pre-check or the DB trigger), `ends_before_start`
 * (a slot with end <= start), `link_failed` (the coach_athletes link could not
 * be written; a newly created athlete row is rolled back first).
 */
export type ImportOutcomeReason = "roster_full" | "ends_before_start" | "link_failed";

export interface ImportOutcomeDTO {
  key: string;
  name: string;
  status: ImportOutcomeStatus;
  slotsAdded: number;
  /** The address the invite went to, for created athletes with an email. */
  invited: string | null;
  /** Human copy, verbatim from the web flow (may include the DB trigger text). */
  message: string | null;
  /** Additive, API-facing (the web ignores it). */
  reason: ImportOutcomeReason | null;
  /** The plan's athlete limit when `reason` is `roster_full`; null for club plans or other reasons. */
  limit: number | null;
}

/** The web's name for the outcome row; identical to the DTO. */
export type ImportOutcome = ImportOutcomeDTO;

export interface CommitScheduleImportResultDTO {
  outcomes: ImportOutcomeDTO[];
}

/* -------------------------------------------------------- image parsing */

const IMAGE_SYSTEM = `You transcribe coaching lesson schedules from photos or screenshots into structured rows.
Report only what is visibly written. Never invent names, emails, times or days.
If a field is not visible, leave it empty (or null). One row per lesson per athlete per week.`;

const IMAGE_PROMPT =
  'Transcribe every lesson in this schedule. Reply with ONLY a JSON array (no markdown fences, no commentary). Each element: {"firstName": string, "lastName": string, "day": string, "startTime": string, "lengthMinutes": number|null, "frequency": "weekly"|"biweekly"|"twice_monthly"|"monthly", "guardianEmail": string|null, "athleteEmail": string|null}.';

const IMAGE_MODEL = "google/gemini-2.5-flash";

export const PHOTO_IMPORT_UNAVAILABLE = "Photo import isn't available right now.";
export const PHOTO_UNREADABLE =
  "Couldn't read that photo. Try a clearer picture, or enter rows manually.";
export const PHOTO_TYPE_REJECTED = "Upload a JPEG or PNG photo.";

/** What the parse route accepts on `blob.type`; iOS transcodes HEIC to JPEG before upload. */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Per-file cap on the uploaded image, enforced by the handler itself. The
 * route's `maxBodyBytes` (same value) is only a Content-Length pre-check; a
 * chunked upload carries no Content-Length, so the handler is the bound that
 * always holds before the bytes reach the paid gateway (precedent:
 * `assertAudioSize` in voice.server.ts).
 */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const PHOTO_TOO_LARGE = "That upload is too large.";

/** 413 `payload_too_large` when the uploaded part exceeds `MAX_IMAGE_BYTES`. */
export function assertImageSize(image: Blob): void {
  if (image.size > MAX_IMAGE_BYTES) {
    throw new ApiError({ code: "payload_too_large", status: 413, message: PHOTO_TOO_LARGE });
  }
}

const str = z.union([z.string(), z.number()]).nullish();

// The model sometimes answers with snake_case keys, so accept both spellings
// and normalize below.
const rawLesson = z
  .object({
    firstName: str,
    first_name: str,
    lastName: str,
    last_name: str,
    name: str,
    athlete_name: str,
    athleteName: str,
    day: str,
    day_of_week: str,
    dayOfWeek: str,
    startTime: str,
    start_time: str,
    lengthMinutes: str,
    length_minutes: str,
    lesson_length_minutes: str,
    frequency: str,
    repeats: str,
    guardianEmail: str,
    guardian_email: str,
    athleteEmail: str,
    athlete_email: str,
    email: str,
  })
  .partial();

type RawLesson = z.infer<typeof rawLesson>;

const text = (v: unknown): string => (v == null ? "" : String(v).trim());

function normalizeRaw(raw: RawLesson): ParsedLesson {
  const full = text(raw.name ?? raw.athlete_name ?? raw.athleteName);
  let firstName = text(raw.firstName ?? raw.first_name);
  let lastName = text(raw.lastName ?? raw.last_name);
  if (!firstName && !lastName && full) {
    const parts = full.split(/\s+/);
    firstName = parts.shift() ?? "";
    lastName = parts.join(" ");
  }
  const lenRaw = raw.lengthMinutes ?? raw.length_minutes ?? raw.lesson_length_minutes;
  const len = lenRaw == null || lenRaw === "" ? null : Number(lenRaw);
  const email = text(raw.email);
  return {
    firstName,
    lastName,
    day: text(raw.day ?? raw.day_of_week ?? raw.dayOfWeek),
    startTime: text(raw.startTime ?? raw.start_time),
    lengthMinutes: Number.isFinite(len as number) ? (len as number) : null,
    frequency: text(raw.frequency ?? raw.repeats),
    guardianEmail: text(raw.guardianEmail ?? raw.guardian_email) || email || null,
    athleteEmail: text(raw.athleteEmail ?? raw.athlete_email) || null,
  };
}

/**
 * Turns the model's reply into raw lessons: strips ``` fences, slices the
 * outermost JSON array, accepts a bare array or a `{ elements }` /
 * `{ lessons }` wrapper, drops elements that don't look like a lesson and
 * rows with neither name. Throws 422 when there is no JSON to parse at all.
 * Exported for tests; the web behavior is unchanged.
 */
export function lessonsFromModelText(out: string): ParsedLesson[] {
  const cleaned = out
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    // Was "Model did not return JSON" — swallowed into the same user-facing
    // string by the web flow; the API gets a stable 422 for it.
    throw unprocessable(PHOTO_UNREADABLE);
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { elements?: unknown[] })?.elements)
      ? (parsed as { elements: unknown[] }).elements
      : Array.isArray((parsed as { lessons?: unknown[] })?.lessons)
        ? (parsed as { lessons: unknown[] }).lessons
        : [];
  const rows = arr
    .map((r) => rawLesson.safeParse(r))
    .filter((r) => r.success)
    .map((r) => (r as { data: RawLesson }).data);
  return rows.map(normalizeRaw).filter((l) => l.firstName || l.lastName);
}

export type ScheduleImageInput = {
  bytes: Uint8Array;
  /** IANA media type of `bytes`, passed to the model as the image part's `mediaType`. */
  mimeType: string;
};

/** The one AI call, injectable so tests never reach the gateway. */
export type ScheduleImageGenerate = (args: {
  model: unknown;
  system: string;
  messages: unknown[];
}) => Promise<{ text: string }>;

async function defaultGenerate(args: {
  model: unknown;
  system: string;
  messages: unknown[];
}): Promise<{ text: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { text } = await generateText(args as any);
  return { text };
}

export type ParseScheduleImageDeps = {
  generate?: ScheduleImageGenerate;
  /** Defaults to `process.env.LOVABLE_API_KEY`. */
  apiKey?: string | null;
};

/**
 * `parseScheduleImageBytes`: one AI call over the image bytes (no data-URL
 * round trip), answering the model's rows as raw text fields. Errors carry
 * the web's exact strings: 503 `ai_unavailable` when the gateway key is
 * missing or the gateway fails, 422 `unprocessable` when the reply holds no
 * JSON. An empty array is a normal 200.
 */
export async function parseScheduleImageBytes(
  input: ScheduleImageInput,
  deps: ParseScheduleImageDeps = {},
): Promise<{ lessons: ParsedLesson[] }> {
  const apiKey = deps.apiKey === undefined ? process.env.LOVABLE_API_KEY : deps.apiKey;
  if (!apiKey) throw aiUnavailable(PHOTO_IMPORT_UNAVAILABLE);
  const generate = deps.generate ?? defaultGenerate;
  const gateway = createLovableAiGatewayProvider(apiKey);

  let out: string;
  try {
    ({ text: out } = await generate({
      model: gateway(IMAGE_MODEL),
      system: IMAGE_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: IMAGE_PROMPT },
            { type: "image", image: input.bytes, mediaType: input.mimeType },
          ],
        },
      ],
    }));
  } catch (err) {
    console.error("[schedule-import] image parse failed", err);
    throw aiUnavailable(PHOTO_UNREADABLE);
  }

  try {
    return { lessons: lessonsFromModelText(out) };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error("[schedule-import] image parse failed", err);
    throw unprocessable(PHOTO_UNREADABLE);
  }
}

/**
 * `normalizeParsedLessons`: the pure step the web performs client-side in
 * `rowsFromParsedLessons` (schedule-import.ts), run on the server for the
 * API. Never invents a value: a day or time that was written but not
 * understood stays null with its `*Unreadable` flag set; the length defaults
 * to 60 only when the model gave nothing usable; an unknown frequency is
 * weekly, exactly as the web review step treats it.
 */
export function normalizeParsedLessons(lessons: ParsedLesson[]): NormalizedLessonDTO[] {
  return lessons.map((l) => {
    const rawDay = l.day.trim();
    const rawStartTime = l.startTime.trim();
    const dayOfWeek = parseDay(rawDay);
    const startMinute = parseTimeToMinutes(rawStartTime);
    const guardianEmail = (l.guardianEmail ?? "").trim().toLowerCase();
    const athleteEmail = (l.athleteEmail ?? "").trim().toLowerCase();
    return {
      firstName: l.firstName.trim(),
      lastName: l.lastName.trim(),
      dayOfWeek,
      startMinute,
      lengthMinutes: l.lengthMinutes && l.lengthMinutes > 0 ? l.lengthMinutes : 60,
      frequency: parseFrequency(l.frequency),
      guardianEmail: guardianEmail || null,
      athleteEmail: athleteEmail || null,
      rawDay,
      rawStartTime,
      dayUnreadable: Boolean(rawDay) && dayOfWeek == null,
      startTimeUnreadable: Boolean(rawStartTime) && startMinute == null,
    };
  });
}

/** The route's multipart body: one file part named `image`. */
export type ParseScheduleImageUploadInput = { image: Blob };

/**
 * `parseScheduleImageUpload`: the API composition over the raw parse — a
 * per-file size cap (413 `payload_too_large`, checked first so an oversized
 * upload costs no database read), coach-only (422 `unprocessable` "Coach
 * profile not found", an API-only tightening; the web wrapper stays
 * auth-only), a MIME allowlist on the uploaded part (400
 * `validation_failed`), then the AI parse and the server normalizer. No
 * database writes; one paid AI call.
 */
export async function parseScheduleImageUpload(
  ctx: ScheduleImportContext,
  input: ParseScheduleImageUploadInput,
  deps: ParseScheduleImageDeps = {},
): Promise<ParseScheduleResultDTO> {
  assertImageSize(input.image);
  await requireCoachProfile(ctx.admin, ctx.userId);
  const mimeType = (input.image.type || "").split(";")[0].trim().toLowerCase();
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mimeType)) {
    throw validationFailed(PHOTO_TYPE_REJECTED);
  }
  const bytes = new Uint8Array(await input.image.arrayBuffer());
  const { lessons } = await parseScheduleImageBytes({ bytes, mimeType }, deps);
  return { lessons: normalizeParsedLessons(lessons) };
}

/**
 * Decodes the web's `data:image/...;base64,...` upload into bytes for
 * `parseScheduleImageBytes`. A malformed data URL is an unreadable photo
 * (the web input is already checked to start with `data:image/`).
 */
export function imageBytesFromDataUrl(dataUrl: string): ScheduleImageInput {
  const m = /^data:([^;,]+)(;[^,]*)?,(.*)$/s.exec(dataUrl);
  if (!m) throw unprocessable(PHOTO_UNREADABLE);
  const mimeType = m[1].trim().toLowerCase();
  const isBase64 = (m[2] ?? "").split(";").includes("base64");
  const payload = m[3];
  try {
    const bytes = isBase64
      ? new Uint8Array(Buffer.from(payload, "base64"))
      : new TextEncoder().encode(decodeURIComponent(payload));
    return { bytes, mimeType };
  } catch {
    // A percent-encoded payload that doesn't decode: the web flow mapped
    // every pre-parse failure to the same "couldn't read" string.
    throw unprocessable(PHOTO_UNREADABLE);
  }
}

/* ----------------------------------------------------------------- commit */

const slotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  frequency: z.enum(["weekly", "biweekly", "twice_monthly", "monthly"]),
  /**
   * Set by the review when the coach links rows that share a day and time
   * into one group lesson (decision #68, GL5). Weekly slots of two to eight
   * different athletes carrying the same key, at the same day and time, are
   * linked as one group once they are saved (`linkImportedGroup`); anything
   * else imports as private lessons, as before.
   */
  groupKey: z.string().min(1).max(100).optional(),
});

type ImportSlot = z.infer<typeof slotSchema>;

/** One lesson time a `groupKey` asks to link, and the import rows (by group `key`) that carry it. */
export type ImportGroupShape = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  athleteKeys: string[];
};

/**
 * The `groupKey`s the import may honor: the key is on the slots of two to
 * eight different rows, every one of those slots is the same weekly lesson,
 * and no row carries it twice. A key that fails any test is ignored (private
 * lessons). Weekly only: the import stores other frequencies without the
 * start date or weeks a group lesson requires, and the group editor on iPhone
 * has no frequency or starting-date control to add them afterwards.
 */
export function importGroupShapes(
  groups: Array<{ key: string; slots: ImportSlot[] }>,
): Map<string, ImportGroupShape> {
  const byKey = new Map<
    string,
    { athletes: Set<string>; shapes: Set<string>; twice: boolean; slot: ImportSlot }
  >();
  for (const g of groups) {
    const mine = new Set<string>();
    for (const s of g.slots) {
      if (!s.groupKey) continue;
      const entry = byKey.get(s.groupKey) ?? {
        athletes: new Set(),
        shapes: new Set(),
        twice: false,
        slot: s,
      };
      if (mine.has(s.groupKey)) entry.twice = true; // one athlete twice in a group is not a group
      mine.add(s.groupKey);
      entry.athletes.add(g.key);
      entry.shapes.add(`${s.dayOfWeek}:${s.startMinute}:${s.endMinute}:${s.frequency}`);
      byKey.set(s.groupKey, entry);
    }
  }
  const out = new Map<string, ImportGroupShape>();
  for (const [key, e] of byKey) {
    if (e.twice || e.shapes.size !== 1 || e.slot.frequency !== "weekly") continue;
    if (e.athletes.size < 2 || e.athletes.size > 8) continue;
    out.set(key, {
      dayOfWeek: e.slot.dayOfWeek,
      startMinute: e.slot.startMinute,
      endMinute: e.slot.endMinute,
      athleteKeys: [...e.athletes],
    });
  }
  return out;
}

type LinkRow = {
  id: string;
  athlete_id: string;
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  frequency: string | null;
  weeks_of_month: number[] | null;
  starts_on: string | null;
  group_id?: string | null;
};

/**
 * Links the lessons of one same-time set into a group, after they are saved
 * (decision #68, GL5). Run once the import's rows have landed, so a group is
 * never made of athletes who were skipped or failed, and so importing again
 * joins the ones a first attempt left out: the members are whoever has that
 * exact weekly lesson now, not yet in a group. When two or more of the set
 * are already one group at that time (a first attempt linked them), the rest
 * join that group, at its price, if all of them fit within eight.
 *
 * An athlete with another lesson overlapping this one stays out (the same
 * rule `createLessonGroup` enforces). With no group to join, fewer than two
 * left or more than eight: nothing is linked and the lessons stay private.
 * Never throws: a
 * failure here leaves private lessons, which is what the import made before.
 */
async function linkImportedGroup(
  admin: Admin,
  coachId: string,
  shape: ImportGroupShape,
  athleteIds: string[],
): Promise<void> {
  if (athleteIds.length < 2) return;
  const res = (await admin
    .from("athlete_lesson_slots")
    .select(
      "id, athlete_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on, group_id",
    )
    .eq("coach_id", coachId)
    .eq("day_of_week", shape.dayOfWeek)
    .in("athlete_id", athleteIds)) as unknown as {
    data: LinkRow[] | null;
    error: { code?: string; message: string } | null;
  };
  // No `group_id` column before migration 20261115120000: the lessons stay private.
  if (res.error) {
    if (!missingGroupColumn(res.error))
      console.error("[schedule-import] group not linked", res.error);
    return;
  }
  const rows = res.data ?? [];
  const members: LinkRow[] = [];
  for (const athleteId of new Set(athleteIds)) {
    const mine = rows.filter((r) => r.athlete_id === athleteId);
    const lesson = mine.find(
      (r) =>
        r.group_id == null &&
        r.start_minute === shape.startMinute &&
        r.end_minute === shape.endMinute &&
        (r.frequency ?? "weekly") === "weekly",
    );
    if (!lesson) continue;
    if (mine.some((r) => r.id !== lesson.id && slotsCoincide(r, lesson))) continue;
    members.push(lesson);
  }
  // A group at exactly this lesson that already holds two or more of this
  // set is the one a first attempt made: the rest join it. One athlete in
  // some other group, two such groups, or no room left is not that case, and
  // the ungrouped ones are linked among themselves as before.
  const grouped = new Map<string, number>();
  for (const r of rows) {
    if (
      r.group_id != null &&
      r.start_minute === shape.startMinute &&
      r.end_minute === shape.endMinute &&
      (r.frequency ?? "weekly") === "weekly"
    )
      grouped.set(r.group_id, (grouped.get(r.group_id) ?? 0) + 1);
  }
  const firstAttempts = [...grouped].filter(([, n]) => n >= 2).map(([id]) => id);
  if (firstAttempts.length === 1 && members.length > 0) {
    const groupId = firstAttempts[0];
    const group = (await admin
      .from("athlete_lesson_slots")
      .select("id, price_cents")
      .eq("coach_id", coachId)
      .eq("group_id", groupId)) as unknown as {
      data: Array<{ id: string; price_cents: number | null }> | null;
      error: { code?: string; message: string } | null;
    };
    if (group.error) {
      if (!missingGroupColumn(group.error))
        console.error("[schedule-import] group not joined", group.error);
      return;
    }
    const current = group.data ?? [];
    if (current.length >= 2 && current.length + members.length <= 8) {
      // The group's price only when every member shares one (the rule
      // `updateLessonGroup` reads it by); otherwise each athlete's usual rate.
      const prices = new Set(current.map((g) => g.price_cents));
      const price = prices.size === 1 ? current[0].price_cents : null;
      const join = (await admin
        .from("athlete_lesson_slots")
        .update({ group_id: groupId, price_cents: price } as never)
        .eq("coach_id", coachId)
        .in(
          "id",
          members.map((m) => m.id),
        )) as unknown as { error: { code?: string; message: string } | null };
      if (join.error && !missingGroupColumn(join.error)) {
        console.error("[schedule-import] group not joined", join.error);
      }
      return;
    }
  }
  if (members.length < 2 || members.length > 8) return;
  const upd = (await admin
    .from("athlete_lesson_slots")
    .update({ group_id: crypto.randomUUID() } as never)
    .eq("coach_id", coachId)
    .in(
      "id",
      members.map((m) => m.id),
    )) as unknown as { error: { code?: string; message: string } | null };
  if (upd.error && !missingGroupColumn(upd.error)) {
    console.error("[schedule-import] group not linked", upd.error);
  }
}

const missingGroupColumn = (error: { code?: string } | null) =>
  error?.code === "42703" || error?.code === "PGRST204";

/**
 * Verbatim from the web flow. Server leniency is deliberate parity: no email
 * or birthdate is required here (the web review step enforces an email
 * client-side) — flagged as an open question for the API.
 *
 * `currentLevelKey` / `seasonGoalKey` per group (decision #60, 2026-10-27):
 * the coach's optional starting levels for the group's `sport`, both or
 * neither, each a key of that sport's catalog. Written as the athlete's
 * first goals row (set by the coach) when the group creates the athlete; an
 * athlete who already has goals for the sport keeps them.
 */
export const commitScheduleImportInput = z.object({
  groups: z
    .array(
      z
        .object({
          key: z.string().min(1).max(300),
          firstName: z.string().trim().min(1).max(80),
          lastName: z.string().trim().min(1).max(80),
          guardianEmail: z.string().trim().toLowerCase().max(255).default(""),
          athleteEmail: z.string().trim().toLowerCase().max(255).default(""),
          /** The parent or guardian's name as the coach typed it (iOS review card, Under 18). Stored on the new athlete row until the parent claims. */
          guardianFirstName: z.string().trim().max(80).default(""),
          guardianLastName: z.string().trim().max(80).default(""),
          sport: z.string().trim().max(40).default(""),
          emailRecipient: z.enum(["guardian", "athlete"]).default("guardian"),
          slots: z.array(slotSchema).min(1).max(20),
          currentLevelKey: startingLevelKeySchema,
          seasonGoalKey: startingLevelKeySchema,
        })
        .superRefine(refineStartingLevels),
    )
    .min(1)
    .max(100),
});

export type CommitScheduleImportInput = z.infer<typeof commitScheduleImportInput>;

type CoachProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  organization_id: string | null;
  subscription_tier: string | null;
};

async function requireCoachProfile(admin: Admin, userId: string): Promise<CoachProfileRow> {
  const coach = await admin
    .from("coach_profiles")
    .select("id, first_name, last_name, organization_id, subscription_tier")
    .eq("user_id", userId)
    .maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) throw unprocessable("Coach profile not found");
  return coach.data as CoachProfileRow;
}

const normName = (first: string, last: string) =>
  `${first} ${last}`.trim().toLowerCase().replace(/\s+/g, " ");

/** The never-throwing email helpers, injectable for tests. */
export type CommitScheduleImportDeps = {
  newGuardianToken?: () => string;
  sendGuardianInvite?: (params: {
    to: string;
    athleteName: string;
    coachName?: string | null;
    token: string;
    recipient?: "guardian" | "athlete";
  }) => Promise<void>;
  now?: () => Date;
};

/**
 * `commitScheduleImport`: sequential, non-transactional, per group — a
 * failure in one athlete never undoes another (the `outcomes` list says
 * what happened to each). Re-running is safe: athletes already on THIS
 * coach's roster are matched by name (`linked`, never a second invite) and
 * slots are de-duplicated on day + start. Idempotency-Key replay on the
 * route is the only guard against a double submit.
 *
 * The plan cap is pre-checked with the TS mirror of the DB rule
 * (`athleteLimitForTier`) so the coach sees "skipped — roster full" instead
 * of a raw trigger error; the trigger `enforce_coach_roster_cap` remains the
 * backstop and, when it fires inside a group, stays a per-group `failed`
 * outcome with `reason: "roster_full"` — never a route-level 409.
 */
export async function commitScheduleImport(
  ctx: ScheduleImportContext,
  input: CommitScheduleImportInput,
  _opts: ScheduleImportOptions = {},
  deps: CommitScheduleImportDeps = {},
): Promise<CommitScheduleImportResultDTO> {
  const { admin, userId } = ctx;
  const guardian = await import("./guardian.server");
  const newGuardianToken = deps.newGuardianToken ?? guardian.newGuardianToken;
  const sendGuardianInvite = deps.sendGuardianInvite ?? guardian.sendGuardianInvite;
  const now = deps.now ?? (() => new Date());

  const coach = await requireCoachProfile(admin, userId);
  const coachId = coach.id;
  const coachName = `${coach.first_name} ${coach.last_name}`.trim();

  // Athletes already on this coach's roster, keyed by normalized name, so a
  // repeat import attaches lessons instead of creating a duplicate. Only this
  // coach's links are consulted — nothing about anyone else's account.
  const rosterByName = new Map<string, string>();
  let rosterCount = 0;
  {
    const links = await admin.from("coach_athletes").select("athlete_id").eq("coach_id", coachId);
    if (links.error) dbError(links.error);
    const ids = (links.data ?? []).map((r) => r.athlete_id as string);
    rosterCount = ids.length;
    if (ids.length > 0) {
      const rows = await admin.from("athletes").select("id, first_name, last_name").in("id", ids);
      if (rows.error) dbError(rows.error);
      for (const a of rows.data ?? []) {
        const k = normName(a.first_name as string, a.last_name as string);
        if (!rosterByName.has(k)) rosterByName.set(k, a.id as string);
      }
    }
  }

  // Plan cap: the DB trigger is the backstop, but we stop short of it so the
  // coach gets "skipped — roster full" instead of a raw database error.
  const athleteLimit = athleteLimitForTier(
    computeEffectiveTier({
      organizationId: coach.organization_id ?? null,
      subscriptionTier: (coach.subscription_tier as "coach" | "coach_pro" | null) ?? null,
    }),
  );
  let room =
    athleteLimit === null ? Number.POSITIVE_INFINITY : Math.max(0, athleteLimit - rosterCount);

  const outcomes: ImportOutcomeDTO[] = [];
  // Linked after the lessons are saved (`linkImportedGroup`), from who actually landed.
  const groupShapes = importGroupShapes(input.groups);
  const athleteByKey = new Map<string, string>();

  for (const g of input.groups) {
    const name = `${g.firstName} ${g.lastName}`.trim();
    // One address either way. Decision #59 (2026-10-27) amends #30: the
    // review card asks Under 18 / Over 18, so an "athlete" choice is the
    // coach saying the athlete is an adult — the invite goes to the athlete
    // in their own voice. Under 18 (the default) stays guardian-voiced.
    const inviteEmail =
      (g.emailRecipient === "athlete"
        ? g.athleteEmail || g.guardianEmail
        : g.guardianEmail || g.athleteEmail) || null;
    const inviteRecipient =
      g.emailRecipient === "athlete" ? ("athlete" as const) : ("guardian" as const);

    for (const s of g.slots) {
      if (s.endMinute <= s.startMinute) {
        outcomes.push({
          key: g.key,
          name,
          status: "failed",
          slotsAdded: 0,
          invited: null,
          message: "Lesson ends before it starts.",
          reason: "ends_before_start",
          limit: null,
        });
      }
    }
    if (outcomes.some((o) => o.key === g.key && o.status === "failed")) continue;

    // Resolve silently, server-side: only athletes already on THIS coach's
    // roster can be reused.
    let athleteId = rosterByName.get(normName(g.firstName, g.lastName)) ?? null;
    let created = false;
    let invited: string | null = null;

    if (!athleteId) {
      if (room <= 0) {
        outcomes.push({
          key: g.key,
          name,
          status: "skipped",
          slotsAdded: 0,
          invited: null,
          message:
            athleteLimit === null
              ? "Roster limit reached."
              : `Roster limit reached (${athleteLimit} athletes on your plan).`,
          reason: "roster_full",
          limit: athleteLimit,
        });
        continue;
      }
      room -= 1;
    }

    // Set when the failure is the coach_athletes link (the athlete row was
    // rolled back), so the outcome can say so without parsing the message.
    let linkFailed = false;

    try {
      if (!athleteId) {
        const token = inviteEmail ? newGuardianToken() : null;
        const ins = await admin
          .from("athletes")
          .insert({
            first_name: g.firstName,
            last_name: g.lastName,
            parent_id: null,
            self_managed: false,
            motivation: "",
            guardian_email: inviteEmail,
            guardian_first_name:
              inviteRecipient === "guardian" ? g.guardianFirstName || null : null,
            guardian_last_name: inviteRecipient === "guardian" ? g.guardianLastName || null : null,
            guardian_claim_token: token,
            guardian_invited_at: inviteEmail ? now().toISOString() : null,
            added_by_coach_id: coachId,
            invite_recipient: inviteRecipient,
          })
          .select("id")
          .single();
        // Per-group failures below are caught by this loop and reported as a
        // `failed` outcome with the message verbatim (the web shows it) —
        // they never reach the API's error mapping.
        if (ins.error) throw groupFailure(ins.error.message);
        athleteId = ins.data.id;
        created = true;

        const link = await admin.from("coach_athletes").insert({
          coach_id: coachId,
          athlete_id: athleteId,
          coach_ack_at: now().toISOString(),
        });
        if (link.error) {
          await admin.from("athletes").delete().eq("id", athleteId);
          linkFailed = true;
          throw groupFailure(link.error.message);
        }

        if (inviteEmail && token) {
          await sendGuardianInvite({
            to: inviteEmail,
            athleteName: name,
            coachName,
            token,
            recipient: inviteRecipient,
          });
          invited = inviteEmail;
        }
      } else {
        const existing = await admin
          .from("coach_athletes")
          .select("id")
          .eq("coach_id", coachId)
          .eq("athlete_id", athleteId)
          .maybeSingle();
        if (!existing.data) {
          const link = await admin.from("coach_athletes").insert({
            coach_id: coachId,
            athlete_id: athleteId,
            coach_ack_at: now().toISOString(),
          });
          if (link.error) {
            linkFailed = true;
            throw groupFailure(link.error.message);
          }
        }
      }

      if (g.sport) {
        const hasSport = await admin
          .from("coach_athlete_sports")
          .select("id")
          .eq("coach_id", coachId)
          .eq("athlete_id", athleteId)
          .eq("sport", g.sport)
          .maybeSingle();
        if (!hasSport.data) {
          // Best effort, as on the web: a failed sport link never fails the athlete.
          await admin
            .from("coach_athlete_sports")
            .insert({ coach_id: coachId, athlete_id: athleteId, sport: g.sport });
        }

        // Starting levels (decision #60): only when this group created the
        // athlete — an athlete reused by name keeps whatever goals they have
        // (and `applyCoachStartingLevels` never overwrites an existing row
        // either way). Best effort: a failure never fails the athlete.
        const levels = startingLevelsOf(g);
        if (levels && created) {
          try {
            await applyCoachStartingLevels(admin, {
              athleteId,
              sport: g.sport,
              coachId,
              coachUserId: userId,
              ...levels,
            });
          } catch (err) {
            console.error("[schedule-import] starting levels not saved", err);
          }
        }
      }

      const existingSlots = await admin
        .from("athlete_lesson_slots")
        .select("day_of_week, start_minute")
        .eq("coach_id", coachId)
        .eq("athlete_id", athleteId);
      // Unread, a lesson already there would be added a second time.
      if (existingSlots.error) throw groupFailure(existingSlots.error.message);
      const seen = new Set(
        (existingSlots.data ?? []).map((s) => `${s.day_of_week}:${s.start_minute}`),
      );

      const toInsert = g.slots
        .filter((s) => !seen.has(`${s.dayOfWeek}:${s.startMinute}`))
        .map((s) => ({
          athlete_id: athleteId as string,
          coach_id: coachId,
          day_of_week: s.dayOfWeek,
          start_minute: s.startMinute,
          end_minute: s.endMinute,
          frequency: s.frequency,
          // Parity with the web: both monthly kinds land on week 1 (open question).
          weeks_of_month: s.frequency === "twice_monthly" || s.frequency === "monthly" ? [1] : [],
          starts_on: null,
        }));

      if (toInsert.length > 0) {
        const slotIns = await admin.from("athlete_lesson_slots").insert(toInsert);
        if (slotIns.error) throw groupFailure(slotIns.error.message);
      }
      athleteByKey.set(g.key, athleteId as string);

      outcomes.push({
        key: g.key,
        name,
        status: created ? "created" : "linked",
        slotsAdded: toInsert.length,
        invited,
        message:
          toInsert.length < g.slots.length
            ? `${g.slots.length - toInsert.length} lesson(s) already existed`
            : null,
        reason: null,
        limit: null,
      });
    } catch (err) {
      console.error("[schedule-import] group failed", err);
      const rosterFull = isRosterFullError(err);
      outcomes.push({
        key: g.key,
        name,
        status: "failed",
        slotsAdded: 0,
        invited: null,
        message: err instanceof Error ? err.message : "Could not import this athlete.",
        reason: rosterFull ? "roster_full" : linkFailed ? "link_failed" : null,
        limit: rosterFull ? athleteLimit : null,
      });
    }
  }

  for (const shape of groupShapes.values()) {
    const athleteIds = shape.athleteKeys
      .map((key) => athleteByKey.get(key))
      .filter((id): id is string => id != null);
    await linkImportedGroup(admin, coachId, shape, athleteIds);
  }

  return { outcomes };
}

/**
 * A per-group failure inside `commitScheduleImport`'s loop. Always caught by
 * the loop's `catch` and turned into a `failed` outcome carrying the message
 * verbatim (the web shows it, including the roster-cap trigger text), so it
 * never crosses the API boundary.
 */
class GroupFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupFailure";
  }
}

function groupFailure(message: string): GroupFailure {
  return new GroupFailure(message);
}
