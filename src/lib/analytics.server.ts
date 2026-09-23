/**
 * Usage analytics intake (PRD decision #19, §6.12, milestone A1): the iOS
 * app's batches of screen-time and Resources events, written to
 * `analytics_events` (migration 20260923010000) with the admin client.
 *
 * What the client may send is allow-listed here: an event name, an area, a
 * screen id, an optional resource id and duration, and a few typed props per
 * event. Free text never is (no message, note, plan or question text, no
 * search terms). Everything about *who* is derived server-side:
 * - role from the account (`resolveCallerRole`), never the client;
 * - an athlete is a minor unless their birthdate on file confirms 18+ (a
 *   missing or unreadable birthdate counts as a minor, like the Ask Gradus
 *   age gate; deliberately not `isMinorBirthdate`);
 * - a minor's rows carry no user id, an age band, and only the clubs and
 *   regions of their coaches' organizations that have at least 10 minor
 *   athletes right now; never a coach, parent or athlete id (§12 #22).
 *
 * Event ids are client-generated UUIDs and the table's primary key, so a
 * retried batch inserts nothing twice.
 */
import { z } from "zod";
import { resolveCallerRole } from "./caller-role.server";
import { dbError } from "./db-error";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnalyticsDb = { from: (table: string) => any; rpc: (fn: string, args: any) => any };

/** A club or region is named in a minor's row only with at least this many minor athletes. */
export const MIN_GROUP_MINORS = 10;
export const MAX_EVENTS_PER_BATCH = 100;
/** A single stretch of screen time is capped at 30 minutes (§6.12). */
export const MAX_DURATION_MS = 30 * 60 * 1000;

export const ANALYTICS_AREAS = [
  "roster",
  "schedule",
  "plans",
  "sessions",
  "messages",
  "board",
  "resources",
  "ask",
  "settings",
  "onboarding",
] as const;

const unit = z.number().min(0).max(1);

/** Each event's allowed props; anything else is dropped. Mirrored in docs/api/vectors/analytics-events.json. */
export const EVENT_PROPS = {
  screen_time: z.object({}).strict(),
  resource_open: z
    .object({
      kind: z.enum(["pdf", "image", "link"]).optional(),
      sport: z.string().max(40).optional(),
      origin: z.enum(["library", "coach"]).optional(),
    })
    .strict(),
  resource_read: z
    .object({ depth: unit.optional(), pages: z.number().int().min(0).max(5000).optional() })
    .strict(),
  resource_share: z.object({}).strict(),
  resource_offline_save: z.object({}).strict(),
  library_search: z.object({ resultCount: z.number().int().min(0).max(10000) }).strict(),
  safe_sport_open: z.object({}).strict(),
  ask_question: z
    .object({
      grounded: z.boolean().optional(),
      safety: z.boolean().optional(),
      sourceCount: z.number().int().min(0).max(20).optional(),
    })
    .strict(),
  ask_answer_saved: z.object({}).strict(),
  ask_source_tap: z.object({ index: z.number().int().min(1).max(20) }).strict(),
} as const;

export type AnalyticsEventName = keyof typeof EVENT_PROPS;
export const ANALYTICS_EVENTS = Object.keys(EVENT_PROPS) as AnalyticsEventName[];

const eventSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  event: z.enum(ANALYTICS_EVENTS as [AnalyticsEventName, ...AnalyticsEventName[]]),
  area: z.enum(ANALYTICS_AREAS),
  /** A stable screen identifier such as "resources.viewer"; never user text. */
  screen: z
    .string()
    .max(80)
    .regex(/^[A-Za-z0-9._-]*$/),
  resourceId: z.string().uuid().optional(),
  durationMs: z.number().int().min(0).max(MAX_DURATION_MS).optional(),
  capped: z.boolean().optional(),
  props: z.record(z.unknown()).optional(),
});

export const analyticsBatchInput = z.object({
  platform: z.enum(["ios"]),
  appVersion: z.string().max(40),
  osVersion: z.string().max(40),
  events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

export type AnalyticsBatch = z.infer<typeof analyticsBatchInput>;

/** Drops props the event doesn't allow (never rejects a batch over them). */
export function cleanProps(event: AnalyticsEventName, props: unknown): Record<string, unknown> {
  const parsed = EVENT_PROPS[event].safeParse(props ?? {});
  if (parsed.success) return parsed.data as Record<string, unknown>;
  // Keep only the valid keys one by one.
  const shape = EVENT_PROPS[event].shape as Record<string, z.ZodTypeAny>;
  const out: Record<string, unknown> = {};
  if (props && typeof props === "object") {
    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      if (shape[k]?.safeParse(v).success) out[k] = v;
    }
  }
  return out;
}

export type AgeBand = "under_13" | "13_15" | "16_17" | "unknown" | "18_plus";

/** Age band on `now`'s date; a missing or unreadable birthdate is "unknown" (and a minor). */
export function ageBand(birthdate: string | null | undefined, now: Date): AgeBand {
  if (!birthdate) return "unknown";
  const dob = new Date(birthdate);
  if (Number.isNaN(dob.getTime())) return "unknown";
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age >= 18) return "18_plus";
  if (age >= 16) return "16_17";
  if (age >= 13) return "13_15";
  return "under_13";
}

export interface Subject {
  userId: string | null;
  subject: "adult" | "minor_athlete";
  role: string;
  ageBand: AgeBand | null;
  orgIds: string[];
  regions: string[];
  hasClub: boolean;
}

/** Who the caller is for analytics, derived entirely server-side. */
export async function resolveSubject(
  admin: AnalyticsDb,
  userId: string,
  now: Date,
): Promise<Subject> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role = (await resolveCallerRole(admin as any, userId)) ?? "none";
  if (role !== "athlete") {
    return {
      userId,
      subject: "adult",
      role,
      ageBand: null,
      orgIds: [],
      regions: [],
      hasClub: false,
    };
  }
  const athlete = await admin
    .from("athletes")
    .select("id, birthdate")
    .eq("user_id", userId)
    .maybeSingle();
  if (athlete.error) dbError(athlete.error);
  const band = ageBand(athlete.data?.birthdate ?? null, now);
  if (band === "18_plus") {
    return {
      userId,
      subject: "adult",
      role,
      ageBand: band,
      orgIds: [],
      regions: [],
      hasClub: false,
    };
  }

  // A minor: their coaches' clubs and regions, each only if big enough to name.
  const athleteId = athlete.data?.id as string | undefined;
  let orgs: { id: string; region: string | null }[] = [];
  if (athleteId) {
    const links = await admin.from("coach_athletes").select("coach_id").eq("athlete_id", athleteId);
    if (links.error) dbError(links.error);
    const coachIds = [
      ...new Set(((links.data ?? []) as { coach_id: string }[]).map((l) => l.coach_id)),
    ];
    if (coachIds.length) {
      const coaches = await admin
        .from("coach_profiles")
        .select("organization_id")
        .in("id", coachIds);
      if (coaches.error) dbError(coaches.error);
      const orgIds = [
        ...new Set(
          ((coaches.data ?? []) as { organization_id: string | null }[])
            .map((c) => c.organization_id)
            .filter((id): id is string => !!id),
        ),
      ];
      if (orgIds.length) {
        const o = await admin.from("organizations").select("id, region").in("id", orgIds);
        if (o.error) dbError(o.error);
        orgs = (o.data ?? []) as { id: string; region: string | null }[];
      }
    }
  }
  const named = await namedGroups(admin, orgs);
  return {
    userId: null,
    subject: "minor_athlete",
    role,
    ageBand: band,
    orgIds: named.orgIds,
    regions: named.regions,
    hasClub: orgs.length > 0,
  };
}

/** The clubs and regions with at least `MIN_GROUP_MINORS` minor athletes right now. */
async function namedGroups(
  admin: AnalyticsDb,
  orgs: { id: string; region: string | null }[],
): Promise<{ orgIds: string[]; regions: string[] }> {
  if (!orgs.length) return { orgIds: [], regions: [] };
  const regionsIn = [...new Set(orgs.map((o) => o.region?.trim()).filter((r): r is string => !!r))];
  const [orgCounts, regionCounts] = await Promise.all([
    admin.rpc("analytics_org_minor_counts", { p_org_ids: orgs.map((o) => o.id) }),
    regionsIn.length
      ? admin.rpc("analytics_region_minor_counts", { p_regions: regionsIn })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (orgCounts.error) dbError(orgCounts.error);
  if (regionCounts.error) dbError(regionCounts.error);
  const bigOrgs = ((orgCounts.data ?? []) as { org_id: string; minors: number }[])
    .filter((r) => Number(r.minors) >= MIN_GROUP_MINORS)
    .map((r) => r.org_id);
  const bigRegions = ((regionCounts.data ?? []) as { region: string; minors: number }[])
    .filter((r) => Number(r.minors) >= MIN_GROUP_MINORS)
    .map((r) => r.region);
  return { orgIds: bigOrgs.sort(), regions: bigRegions.sort() };
}

/** The rows a batch becomes for one subject. Pure. */
export function analyticsRows(batch: AnalyticsBatch, who: Subject) {
  return batch.events.map((e) => ({
    id: e.id,
    occurred_at: e.occurredAt,
    user_id: who.subject === "adult" ? who.userId : null,
    subject: who.subject,
    role: who.role,
    age_band: who.ageBand,
    session_id: e.sessionId,
    platform: batch.platform,
    app_version: batch.appVersion,
    os_version: batch.osVersion,
    event: e.event,
    area: e.area,
    screen: e.screen,
    resource_id: e.resourceId ?? null,
    duration_ms: e.durationMs ?? null,
    capped: e.capped ?? false,
    org_ids: who.orgIds,
    regions: who.regions,
    has_club: who.hasClub,
    props: cleanProps(e.event, e.props),
  }));
}

/** `POST /api/v1/analytics/events`: stores a batch; returns how many events it accepted. */
export async function recordAnalyticsBatch(
  admin: AnalyticsDb,
  userId: string,
  batch: AnalyticsBatch,
  now: Date = new Date(),
): Promise<{ accepted: number }> {
  const who = await resolveSubject(admin, userId, now);
  const rows = analyticsRows(batch, who);
  const { error } = await admin
    .from("analytics_events")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (error) dbError(error);
  return { accepted: rows.length };
}
