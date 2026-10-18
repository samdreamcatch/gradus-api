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
 *
 * Consent (decision #46, 2026-10-04): there is no in-app switch. Consent is
 * part of accepting the Terms and Privacy Policy at sign-up; the policy says
 * to email support@gradussports.com to withdraw it, and an admin records the
 * request on the user's admin page (`setAnalyticsOptOut`). A withdrawn
 * account's batches are accepted and discarded (`accepted: 0`), never
 * refused, so the app keeps working and nothing of theirs is stored.
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
      // A sport key ("figure_skating"), never free text.
      sport: z
        .string()
        .regex(/^[a-z_]{1,40}$/)
        .optional(),
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
  // A request enum, so widening it is safe for the installed iOS app
  // (docs/android/PRD.md S-2, §4.1 rule 15).
  platform: z.enum(["ios", "android", "wearos"]),
  // Version-like text only ("1.0.0 (12)", "26.0").
  appVersion: z.string().regex(/^[0-9A-Za-z .()_-]{0,40}$/),
  osVersion: z.string().regex(/^[0-9A-Za-z .()_-]{0,40}$/),
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

/**
 * Who the caller is for analytics, derived entirely server-side. An account
 * with an athlete record is always judged as an athlete first, whatever
 * other profile rows it has, so role precedence can never let a minor
 * through as an adult.
 */
export async function resolveSubject(
  admin: AnalyticsDb,
  userId: string,
  now: Date,
): Promise<Subject> {
  const athlete = await admin
    .from("athletes")
    .select("id, birthdate")
    .eq("user_id", userId)
    .maybeSingle();
  if (athlete.error) dbError(athlete.error);
  if (!athlete.data) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const role = (await resolveCallerRole(admin as any, userId)) ?? "none";
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
  const role = "athlete";
  const band = ageBand(athlete.data.birthdate ?? null, now);
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

/** Postgres `undefined_table`, or PostgREST's schema-cache miss for a table that isn't there yet. */
function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export interface AnalyticsOptOut {
  requestedAt: string;
  note: string;
}

/** The account's withdrawal of consent, if it made one (privacy policy §2.4). */
export async function getAnalyticsOptOut(
  admin: AnalyticsDb,
  userId: string,
): Promise<AnalyticsOptOut | null> {
  const row = await admin
    .from("analytics_opt_outs")
    .select("requested_at, note")
    .eq("user_id", userId)
    .maybeSingle();
  // Until Lovable applies migration 20261004120000 the table is missing;
  // nobody can have withdrawn yet, so ingestion and the admin page carry on.
  if (row.error && isMissingTable(row.error)) return null;
  if (row.error) dbError(row.error);
  if (!row.data) return null;
  return {
    requestedAt: String((row.data as { requested_at: string }).requested_at),
    note: String((row.data as { note?: string }).note ?? ""),
  };
}

/**
 * Records (or clears) an account's withdrawal of consent to usage-data
 * collection, by hand after an emailed request (decision #46). Withdrawing
 * runs `analytics_withdraw_consent` (migration 20261004120000): one
 * transaction that inserts the request row and deletes every stored event
 * carrying the account's user id, returning how many. A minor athlete's
 * events carry none, so for them it stops future collection only.
 * Idempotent either way.
 */
export async function setAnalyticsOptOut(
  admin: AnalyticsDb,
  userId: string,
  optedOut: boolean,
  recordedBy: string,
  note = "",
): Promise<{ optedOut: boolean; deletedEvents: number }> {
  if (optedOut) {
    const res = await admin.rpc("analytics_withdraw_consent", {
      p_user_id: userId,
      p_recorded_by: recordedBy,
      p_note: note.trim().slice(0, 200),
    });
    if (res.error) dbError(res.error);
    return { optedOut: true, deletedEvents: Number(res.data ?? 0) };
  }
  const del = await admin.from("analytics_opt_outs").delete().eq("user_id", userId);
  if (del.error) dbError(del.error);
  return { optedOut: false, deletedEvents: 0 };
}

/**
 * `POST /api/v1/analytics/events`: stores a batch; returns how many events it
 * accepted. An account that withdrew consent gets `accepted: 0` and nothing
 * is stored or even looked up about it.
 */
export async function recordAnalyticsBatch(
  admin: AnalyticsDb,
  userId: string,
  batch: AnalyticsBatch,
  now: Date = new Date(),
): Promise<{ accepted: number }> {
  // Check-then-write: a batch already past this check when a withdrawal is
  // recorded can land after that withdrawal's delete. That is at most one
  // request's worth, and the 13-month sweep removes it; a database-side
  // guard was judged not worth it for a by-hand process.
  if (await getAnalyticsOptOut(admin, userId)) return { accepted: 0 };
  const who = await resolveSubject(admin, userId, now);
  const rows = analyticsRows(batch, who);
  const { error } = await admin
    .from("analytics_events")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (error) dbError(error);
  return { accepted: rows.length };
}
