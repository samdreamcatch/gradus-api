/**
 * Live Board Live Activities driven from the server (PRD §6.9 "Live
 * Activity": started by push-to-start when a followed skater's event goes
 * live, updated on each snapshot change that affects that skater, ended
 * when the event is final).
 *
 * Token lifecycle: the app uploads its push-to-start token (`board_start`)
 * and, for every activity it holds, that activity's update token
 * (`board_update` + `activity_key`). `syncBoardLiveActivities` runs after
 * every snapshot refresh (`board-refresh.server.ts`), inside `inBackground`,
 * and mirrors the app's own `BoardActivityPlanner`: live events only,
 * ranked on-ice → up-next → just-scored → waiting → scored, at most five
 * activities per follower. `live_activity_sessions` remembers what was
 * pushed so a refresh only sends real changes.
 *
 * Only signed-in follows (`board_follows.user_id`) can be pushed; anonymous
 * device follows have no tokens.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  apnsConfigFromEnv,
  sendApnsRequest,
  type ApnsConfig,
  type ApnsRequest,
} from "./apns.server";
import { findMySkaters, type SkaterMatch } from "./board-skaters";
import { normalizeName, type BoardPayload } from "./board-types";
import { dbError } from "./db-error";
import type { RegisterLiveActivityTokenInput } from "./api/live-activities-schema";

type Client = SupabaseClient<Database>;
/** The new tables are not in the generated Database types until Lovable regenerates them. */
type Untyped = { from: (table: string) => any };

export type LiveActivityContext = { userId: string; supabase: Client };

/* ------------------------------------------------------------ token CRUD */

export async function registerLiveActivityToken(
  ctx: LiveActivityContext,
  data: RegisterLiveActivityTokenInput,
): Promise<{ ok: true }> {
  if (data.kind === "board_update" && !data.activityKey) {
    // Mirrors the route's validation error shape without importing ApiError here.
    throw new Error("activityKey is required for a board_update token.");
  }
  const { error } = await (ctx.supabase as unknown as Untyped).from("live_activity_tokens").upsert(
    {
      user_id: ctx.userId,
      token: data.token,
      kind: data.kind,
      activity_key: data.kind === "board_update" ? data.activityKey : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "token" },
  );
  if (error) throw new Error("Couldn't register this Live Activity token.");
  return { ok: true };
}

export async function unregisterLiveActivityToken(
  ctx: LiveActivityContext,
  token: string,
): Promise<{ ok: true }> {
  await (ctx.supabase as unknown as Untyped)
    .from("live_activity_tokens")
    .delete()
    .eq("token", token)
    .eq("user_id", ctx.userId);
  return { ok: true };
}

/* -------------------------------------------------- content state mirror */

export type Lane = "scheduled" | "waiting" | "upNext" | "onIce" | "justScored" | "scored" | "ended";

/** Mirrors `BoardActivityAttributes.ContentState` (GradusActivities) key for key. */
export type ContentState = {
  lane: Lane;
  startPosition: number;
  of: number;
  ahead: number;
  score?: string;
  place?: string;
  /** Seconds since 2001-01-01 — Swift's default `Date` JSON encoding. */
  updatedAt: number;
  done: number;
};

/** Mirrors `BoardActivityAttributes` key for key. */
export type ActivityAttributes = {
  activityKey: string;
  slug: string;
  competitionName: string;
  skaterName: string;
  eventName: string;
  segment: string;
  rink: string;
};

export type ActivityPlan = { attributes: ActivityAttributes; state: ContentState };

const SWIFT_REFERENCE_EPOCH_MS = Date.UTC(2001, 0, 1);

/** Swift `Date` → the number `JSONEncoder` writes by default (seconds since 2001). */
export function swiftDate(ms: number): number {
  return (ms - SWIFT_REFERENCE_EPOCH_MS) / 1000;
}

/** `BoardActivityPlanner.lane(for:)`. */
export function laneFor(m: SkaterMatch): Lane {
  switch (m.state) {
    case "on-ice":
      return "onIce";
    case "up-next":
      return "upNext";
    case "waiting":
      return "waiting";
    case "scheduled":
      return "scheduled";
    case "scored":
      return m.ahead === -1 ? "justScored" : "scored";
  }
}

/** `BoardActivityPlanner.priority(_:)` — lower wins. */
export function priorityOf(m: SkaterMatch): number {
  switch (m.state) {
    case "on-ice":
      return 0;
    case "up-next":
      return 1;
    case "scored":
      return m.ahead === -1 ? 2 : 4;
    case "waiting":
      return 3;
    case "scheduled":
      return 5;
  }
}

export const ACTIVITY_LIMIT = 5;

/** `BoardActivityPlanner.plans(for:board:now:limit:)`: live events only, ranked, deduped by key, capped. */
export function planActivities(
  matches: SkaterMatch[],
  board: { slug: string; name: string; generatedAt: string | null },
  now: number,
  limit = ACTIVITY_LIMIT,
): ActivityPlan[] {
  const updatedAt = swiftDate(board.generatedAt ? Date.parse(board.generatedAt) || now : now);
  const live = matches.filter((m) => m.event.status === "live");
  const ranked = [...live].sort((a, b) => priorityOf(a) - priorityOf(b));
  const seen = new Set<string>();
  const out: ActivityPlan[] = [];
  for (const m of ranked) {
    const key = `${board.slug}|${m.event.file}|${normalizeName(m.skater.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      attributes: {
        activityKey: key,
        slug: board.slug,
        competitionName: board.name,
        skaterName: m.skater.name,
        eventName: m.event.name,
        segment: m.event.segment,
        rink: m.event.rink,
      },
      state: {
        lane: laneFor(m),
        startPosition: m.skater.start,
        of: m.skater.of,
        ahead: m.ahead,
        ...(m.skater.segScore ? { score: m.skater.segScore } : {}),
        ...(m.skater.place ? { place: m.skater.place } : {}),
        updatedAt,
        done: m.done,
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Stable JSON for change detection (sorted keys). */
export function stateFingerprint(state: ContentState): string {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(state).sort())
    ordered[key] = (state as Record<string, unknown>)[key];
  // `updatedAt` changes on every refresh; the fingerprint deliberately ignores it.
  delete ordered.updatedAt;
  return JSON.stringify(ordered);
}

function laneLabel(lane: Lane, ahead: number): string {
  switch (lane) {
    case "scheduled":
      return "Scheduled";
    case "waiting":
      return `${ahead} ahead`;
    case "upNext":
      return "Up next";
    case "onIce":
      return "On the ice";
    case "justScored":
      return "Just scored";
    case "scored":
      return "Scored";
    case "ended":
      return "Final";
  }
}

/* -------------------------------------------------------------- the sync */

export type LiveActivitySyncDeps = {
  config?: ApnsConfig | null;
  send?: typeof sendApnsRequest;
  now?: () => number;
};

export type LiveActivitySyncReport = {
  followers: number;
  started: number;
  updated: number;
  ended: number;
  skipped?: "no_config" | "no_followers" | "no_payload";
};

type TokenRow = {
  user_id: string;
  token: string;
  kind: "board_start" | "board_update";
  activity_key: string | null;
};
type SessionRow = {
  user_id: string;
  activity_key: string;
  last_state: string;
  ended_at: string | null;
};

/** End-of-activity content: the last known state with the lane set to `ended`. */
function endedState(lastState: string, now: number): ContentState {
  let parsed: Partial<ContentState> = {};
  try {
    parsed = JSON.parse(lastState) as Partial<ContentState>;
  } catch {
    /* an unreadable fingerprint still lets us end the activity */
  }
  return {
    lane: "ended",
    startPosition: parsed.startPosition ?? 0,
    of: parsed.of ?? 0,
    ahead: parsed.ahead ?? -1,
    ...(parsed.score ? { score: parsed.score } : {}),
    ...(parsed.place ? { place: parsed.place } : {}),
    updatedAt: swiftDate(now),
    done: parsed.done ?? 0,
  };
}

/**
 * Reconcile every follower's Live Activities for one competition against a
 * fresh snapshot. Never throws; returns counts for logs and tests.
 */
export async function syncBoardLiveActivities(
  admin: Client,
  comp: { id: string; slug?: string | null; name?: string | null },
  payload: BoardPayload | null,
  deps: LiveActivitySyncDeps = {},
): Promise<LiveActivitySyncReport> {
  const report: LiveActivitySyncReport = { followers: 0, started: 0, updated: 0, ended: 0 };
  if (!payload) return { ...report, skipped: "no_payload" };
  const config = deps.config === undefined ? apnsConfigFromEnv() : deps.config;
  if (!config) return { ...report, skipped: "no_config" };
  const send = deps.send ?? sendApnsRequest;
  const now = deps.now?.() ?? Date.now();
  const db = admin as unknown as Untyped;

  let slug = comp.slug ?? null;
  let name = comp.name ?? null;
  if (!slug || !name) {
    const row = await db.from("competitions").select("slug, name").eq("id", comp.id).maybeSingle();
    if (row.error) dbError(row.error);
    slug = slug ?? (row.data?.slug as string | null) ?? null;
    name = name ?? (row.data?.name as string | null) ?? null;
  }
  if (!slug) return { ...report, skipped: "no_followers" };
  const board = { slug, name: name ?? slug, generatedAt: payload.generatedAt ?? null };

  const followsRes = await db
    .from("board_follows")
    .select("user_id, skater_name")
    .eq("competition_slug", slug);
  if (followsRes.error) dbError(followsRes.error);
  const namesByUser = new Map<string, string[]>();
  for (const f of (followsRes.data ?? []) as { user_id: string | null; skater_name: string }[]) {
    if (!f.user_id) continue;
    namesByUser.set(f.user_id, [...(namesByUser.get(f.user_id) ?? []), f.skater_name]);
  }
  report.followers = namesByUser.size;
  if (namesByUser.size === 0) return { ...report, skipped: "no_followers" };
  const userIds = Array.from(namesByUser.keys());

  const [tokensRes, sessionsRes] = await Promise.all([
    db
      .from("live_activity_tokens")
      .select("user_id, token, kind, activity_key")
      .in("user_id", userIds),
    db
      .from("live_activity_sessions")
      .select("user_id, activity_key, last_state, ended_at")
      .eq("competition_slug", slug)
      .in("user_id", userIds)
      .is("ended_at", null),
  ]);
  if (tokensRes.error) dbError(tokensRes.error);
  if (sessionsRes.error) dbError(sessionsRes.error);

  const startTokens = new Map<string, string[]>();
  const updateTokens = new Map<string, string[]>(); // `${user}|${key}` → tokens
  for (const t of (tokensRes.data ?? []) as TokenRow[]) {
    if (t.kind === "board_start") {
      startTokens.set(t.user_id, [...(startTokens.get(t.user_id) ?? []), t.token]);
    } else if (t.activity_key) {
      const k = `${t.user_id}|${t.activity_key}`;
      updateTokens.set(k, [...(updateTokens.get(k) ?? []), t.token]);
    }
  }
  const sessions = new Map<string, SessionRow>();
  for (const s of (sessionsRes.data ?? []) as SessionRow[])
    sessions.set(`${s.user_id}|${s.activity_key}`, s);

  const dead: string[] = [];
  const nowSec = Math.floor(now / 1000);
  const sendAll = async (
    tokens: string[],
    aps: Record<string, unknown>,
    priority: 5 | 10,
  ): Promise<boolean> => {
    let any = false;
    await Promise.all(
      tokens.map(async (token) => {
        const req: ApnsRequest = {
          token,
          payload: { aps: { timestamp: nowSec, ...aps } },
          pushType: "liveactivity",
          priority,
          expiration: nowSec + 10 * 60,
        };
        const outcome = await send(config, req);
        if (outcome.ok) any = true;
        else if (outcome.dead) dead.push(token);
        else
          console.warn("[live-activities] send failed", {
            status: outcome.status,
            reason: outcome.reason,
          });
      }),
    );
    return any;
  };
  const sessionRows: Record<string, unknown>[] = [];

  for (const [userId, names] of namesByUser) {
    const plans = planActivities(findMySkaters(payload, names), board, now);
    const wanted = new Set(plans.map((p) => p.attributes.activityKey));

    for (const plan of plans) {
      const key = `${userId}|${plan.attributes.activityKey}`;
      const fingerprint = stateFingerprint(plan.state);
      const session = sessions.get(key);
      if (!session) {
        const tokens = startTokens.get(userId) ?? [];
        if (tokens.length === 0) continue; // app-driven only until the device uploads a start token
        const first = plan.attributes.skaterName.split(" ")[0] || plan.attributes.skaterName;
        const ok = await sendAll(
          tokens,
          {
            event: "start",
            "content-state": plan.state,
            "attributes-type": "BoardActivityAttributes",
            attributes: plan.attributes,
            alert: {
              title: `${first}: ${laneLabel(plan.state.lane, plan.state.ahead)}`,
              body: `${plan.attributes.eventName} · ${plan.attributes.rink}`,
            },
            "input-push-token": 1,
          },
          10,
        );
        if (ok) {
          report.started += 1;
          sessionRows.push({
            user_id: userId,
            competition_slug: slug,
            activity_key: plan.attributes.activityKey,
            last_state: fingerprint,
            started_at: new Date(now).toISOString(),
            updated_at: new Date(now).toISOString(),
            ended_at: null,
          });
        }
        continue;
      }
      if (session.last_state === fingerprint) continue;
      const tokens = updateTokens.get(key) ?? [];
      if (tokens.length === 0) continue; // the app has not reported this activity's update token yet
      const urgent = plan.state.lane === "onIce" || plan.state.lane === "justScored";
      const ok = await sendAll(
        tokens,
        { event: "update", "content-state": plan.state },
        urgent ? 10 : 5,
      );
      if (ok) {
        report.updated += 1;
        sessionRows.push({
          user_id: userId,
          competition_slug: slug,
          activity_key: plan.attributes.activityKey,
          last_state: fingerprint,
          updated_at: new Date(now).toISOString(),
          ended_at: null,
        });
      }
    }

    // Anything we were tracking that is no longer wanted is over: the event went final or the skater skated.
    for (const [key, session] of sessions) {
      if (session.user_id !== userId || wanted.has(session.activity_key)) continue;
      const tokens = updateTokens.get(key) ?? [];
      if (tokens.length) {
        await sendAll(
          tokens,
          {
            event: "end",
            "content-state": endedState(session.last_state, now),
            "dismissal-date": nowSec + 15 * 60,
          },
          5,
        );
      }
      report.ended += 1;
      sessionRows.push({
        user_id: userId,
        competition_slug: slug,
        activity_key: session.activity_key,
        last_state: session.last_state,
        updated_at: new Date(now).toISOString(),
        ended_at: new Date(now).toISOString(),
      });
    }
  }

  if (sessionRows.length) {
    const up = await db
      .from("live_activity_sessions")
      .upsert(sessionRows, { onConflict: "user_id,activity_key" });
    if (up.error) console.error("[live-activities] session bookkeeping failed", up.error);
  }
  if (dead.length) {
    const del = await db.from("live_activity_tokens").delete().in("token", dead);
    if (del.error) console.error("[live-activities] pruning dead tokens failed", del.error);
  }
  return report;
}
