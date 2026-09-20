/**
 * Live Board Live Activities driven from the server (PRD §6.9 "Live
 * Activity": started by push-to-start when a followed skater's event goes
 * live, updated on each snapshot change that affects that skater, ended
 * when the event is final).
 *
 * Token lifecycle: the app uploads its push-to-start token (`board_start`)
 * and, for every activity it holds — started locally or by us — that
 * activity's update token (`board_update` + `activity_key`).
 * `syncBoardLiveActivities` runs after every snapshot refresh
 * (`board-refresh.server.ts`, inside `inBackground`) and mirrors the app's
 * own `BoardActivityPlanner`: live events only, ranked on-ice → up-next →
 * just-scored → waiting → scored, at most five activities per follower.
 * `live_activity_sessions` remembers what was pushed so a refresh only
 * sends real changes and two overlapping syncs cannot start the same
 * activity twice (the session row is claimed before the push).
 *
 * Only signed-in follows (`board_follows.user_id`) can be pushed; anonymous
 * device follows have no tokens.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import type { RegisterLiveActivityTokenInput } from "./api/live-activities-schema";
import {
  apnsConfigFromEnv,
  sendApnsRequest,
  type ApnsConfig,
  type ApnsOutcome,
  type ApnsRequest,
} from "./apns.server";
import { findMySkaters, type SkaterMatch } from "./board-skaters";
import { normalizeName, type BoardPayload } from "./board-types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;
/** The new tables are not in the generated Database types until Lovable regenerates them. */
type Untyped = { from: (table: string) => any };

/** Token writes go through the admin client: a push-to-start token is per
 *  device, so account B may need to re-point a row account A left behind,
 *  which the user-scoped client cannot see under RLS. */
export type LiveActivityContext = { userId: string; admin: Client };

/* ------------------------------------------------------------ token CRUD */

export async function registerLiveActivityToken(
  ctx: LiveActivityContext,
  data: RegisterLiveActivityTokenInput,
): Promise<{ ok: true }> {
  if (data.kind === "board_update" && !data.activityKey) {
    throw new ApiError({
      code: "validation_failed",
      status: 400,
      message: "activityKey is required for a board_update token.",
    });
  }
  const { error } = await (ctx.admin as unknown as Untyped).from("live_activity_tokens").upsert(
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
  await (ctx.admin as unknown as Untyped)
    .from("live_activity_tokens")
    .delete()
    .eq("token", token)
    .eq("user_id", ctx.userId);
  return { ok: true };
}

/* -------------------------------------------------- content state mirror */

export type Lane = "scheduled" | "waiting" | "upNext" | "onIce" | "justScored" | "scored" | "ended";

/**
 * Mirrors `BoardActivityAttributes.ContentState` (GradusActivities) key for
 * key. `updatedAt` is unix seconds; the Swift side encodes its `Date` the
 * same way with a custom `Codable` so local and pushed states agree.
 */
export type ContentState = {
  lane: Lane;
  startPosition: number;
  of: number;
  ahead: number;
  score?: string;
  place?: string;
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

/** Unix seconds, as the Swift `ContentState` encodes `updatedAt`. */
export function unixSeconds(ms: number): number {
  return Math.floor(ms / 1000);
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
  const updatedAt = unixSeconds(board.generatedAt ? Date.parse(board.generatedAt) || now : now);
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

/** Stable JSON for change detection (sorted keys); `updatedAt` changes every refresh and is ignored. */
export function stateFingerprint(state: ContentState): string {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(state).sort()) {
    if (key === "updatedAt") continue;
    ordered[key] = (state as Record<string, unknown>)[key];
  }
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

/** End-of-activity content: the last pushed state with the lane set to `ended`. */
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
    updatedAt: unixSeconds(now),
    done: parsed.done ?? 0,
  };
}

/* -------------------------------------------------------------- the sync */

export type LiveActivitySyncDeps = {
  config?: ApnsConfig | null;
  send?: typeof sendApnsRequest;
  now?: () => number;
  /** How many followers are reconciled at once. */
  concurrency?: number;
};

export type LiveActivitySyncReport = {
  followers: number;
  started: number;
  /** Activities the app started locally that the server now tracks. */
  adopted: number;
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
  started_at: string;
  ended_at: string | null;
};

/** Content becomes stale on the Lock Screen if no update arrives in this long (matches the app's local `staleDate`). */
const STALE_AFTER_SECONDS = 180;
/** A start push is worth delivering for a good part of the event; an update only briefly. */
const START_EXPIRY_SECONDS = 3 * 60 * 60;
const UPDATE_EXPIRY_SECONDS = 10 * 60;
/** Lock Screen dismissal after the event ended, and how long APNs keeps trying to deliver that `end`. */
const DISMISS_AFTER_SECONDS = 15 * 60;
const END_EXPIRY_SECONDS = 60 * 60;
/** A session we could never end (the app never uploaded its update token) is given up on after this long. */
const ORPHAN_SESSION_MS = 8 * 60 * 60 * 1000;

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (next !== undefined) await fn(next);
    }
  });
  await Promise.all(workers);
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
  const report: LiveActivitySyncReport = {
    followers: 0,
    started: 0,
    adopted: 0,
    updated: 0,
    ended: 0,
  };
  if (!payload) return { ...report, skipped: "no_payload" };
  const config = deps.config === undefined ? apnsConfigFromEnv() : deps.config;
  if (!config) return { ...report, skipped: "no_config" };
  const send = deps.send ?? sendApnsRequest;
  const now = deps.now?.() ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const nowSec = unixSeconds(now);
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
  const keyPrefix = `${slug}|`;

  const [followsRes, sessionsRes] = await Promise.all([
    db.from("board_follows").select("user_id, skater_name").eq("competition_slug", slug),
    db
      .from("live_activity_sessions")
      .select("user_id, activity_key, last_state, started_at, ended_at")
      .eq("competition_slug", slug)
      .is("ended_at", null),
  ]);
  if (followsRes.error) dbError(followsRes.error);
  if (sessionsRes.error) dbError(sessionsRes.error);

  const namesByUser = new Map<string, string[]>();
  for (const f of (followsRes.data ?? []) as { user_id: string | null; skater_name: string }[]) {
    if (!f.user_id) continue;
    namesByUser.set(f.user_id, [...(namesByUser.get(f.user_id) ?? []), f.skater_name]);
  }
  report.followers = namesByUser.size;
  const openSessions = (sessionsRes.data ?? []) as SessionRow[];
  // Users who unfollowed everything still have activities to end.
  const userIds = Array.from(
    new Set([...namesByUser.keys(), ...openSessions.map((s) => s.user_id)]),
  );
  if (userIds.length === 0) return { ...report, skipped: "no_followers" };

  const tokensRes = await db
    .from("live_activity_tokens")
    .select("user_id, token, kind, activity_key")
    .in("user_id", userIds);
  if (tokensRes.error) dbError(tokensRes.error);
  const startTokens = new Map<string, string[]>();
  const updateTokens = new Map<string, string[]>(); // `${user}|${key}` → tokens
  for (const t of (tokensRes.data ?? []) as TokenRow[]) {
    if (t.kind === "board_start") {
      startTokens.set(t.user_id, [...(startTokens.get(t.user_id) ?? []), t.token]);
    } else if (t.activity_key?.startsWith(keyPrefix)) {
      const k = `${t.user_id}|${t.activity_key}`;
      updateTokens.set(k, [...(updateTokens.get(k) ?? []), t.token]);
    }
  }
  const sessions = new Map<string, SessionRow>();
  for (const s of openSessions) sessions.set(`${s.user_id}|${s.activity_key}`, s);

  const dead: string[] = [];
  const sessionRows: Record<string, unknown>[] = [];

  const sendAll = async (
    tokens: string[],
    aps: Record<string, unknown>,
    priority: 5 | 10,
    expiresInSeconds: number,
  ): Promise<{ delivered: number; transient: number }> => {
    let delivered = 0;
    let transient = 0;
    await Promise.all(
      tokens.map(async (token) => {
        const req: ApnsRequest = {
          token,
          payload: { aps: { timestamp: nowSec, ...aps } },
          pushType: "liveactivity",
          priority,
          expiration: nowSec + expiresInSeconds,
        };
        let outcome: ApnsOutcome;
        try {
          outcome = await send(config, req);
        } catch (err) {
          outcome = {
            ok: false,
            status: 0,
            reason: `SenderError: ${err instanceof Error ? err.message : String(err)}`,
            dead: false,
          };
        }
        if (outcome.ok) delivered += 1;
        else if (outcome.dead) dead.push(token);
        else {
          transient += 1;
          console.warn("[live-activities] send failed", {
            status: outcome.status,
            reason: outcome.reason,
          });
        }
      }),
    );
    return { delivered, transient };
  };

  const claimSession = async (
    userId: string,
    key: string,
    fingerprint: string,
  ): Promise<boolean> => {
    // The row is the lock: two overlapping syncs both try to insert, only one succeeds.
    const res = await db
      .from("live_activity_sessions")
      .upsert(
        {
          user_id: userId,
          competition_slug: slug,
          activity_key: key,
          last_state: fingerprint,
          started_at: nowIso,
          updated_at: nowIso,
          ended_at: null,
        },
        { onConflict: "user_id,activity_key", ignoreDuplicates: true },
      )
      .select("activity_key");
    if (res.error) {
      console.error("[live-activities] session claim failed", res.error);
      return false;
    }
    return ((res.data ?? []) as { activity_key: string }[]).length > 0;
  };

  const releaseSession = async (userId: string, key: string): Promise<void> => {
    await db.from("live_activity_sessions").delete().eq("user_id", userId).eq("activity_key", key);
  };

  const reconcileUser = async (userId: string): Promise<void> => {
    const names = namesByUser.get(userId) ?? [];
    const plans = names.length ? planActivities(findMySkaters(payload, names), board, now) : [];
    const wanted = new Set(plans.map((p) => p.attributes.activityKey));

    for (const plan of plans) {
      const key = plan.attributes.activityKey;
      const sessionKey = `${userId}|${key}`;
      const fingerprint = stateFingerprint(plan.state);
      const session = sessions.get(sessionKey);
      const updateTo = updateTokens.get(sessionKey) ?? [];
      const content = {
        "content-state": plan.state,
        "stale-date": nowSec + STALE_AFTER_SECONDS,
      };
      const urgent = plan.state.lane === "onIce" || plan.state.lane === "justScored";

      if (session) {
        if (session.last_state === fingerprint || updateTo.length === 0) continue;
        const { delivered } = await sendAll(
          updateTo,
          { event: "update", ...content },
          urgent ? 10 : 5,
          UPDATE_EXPIRY_SECONDS,
        );
        if (delivered > 0) {
          report.updated += 1;
          sessionRows.push({
            user_id: userId,
            competition_slug: slug,
            activity_key: key,
            last_state: fingerprint,
            updated_at: nowIso,
            ended_at: null,
          });
        }
        continue;
      }

      if (updateTo.length > 0) {
        // The app started this activity itself and told us its update token:
        // adopt it rather than push-to-start a duplicate, and bring it up to date.
        if (!(await claimSession(userId, key, fingerprint))) continue;
        report.adopted += 1;
        await sendAll(
          updateTo,
          { event: "update", ...content },
          urgent ? 10 : 5,
          UPDATE_EXPIRY_SECONDS,
        );
        continue;
      }

      const startTo = startTokens.get(userId) ?? [];
      if (startTo.length === 0) continue; // app-driven only until the device uploads a start token
      if (!(await claimSession(userId, key, fingerprint))) continue; // another sync got there first
      const first = plan.attributes.skaterName.split(" ")[0] || plan.attributes.skaterName;
      const { delivered, transient } = await sendAll(
        startTo,
        {
          event: "start",
          ...content,
          "attributes-type": "BoardActivityAttributes",
          attributes: plan.attributes,
          alert: {
            title: `${first}: ${laneLabel(plan.state.lane, plan.state.ahead)}`,
            body: `${plan.attributes.eventName} · ${plan.attributes.rink}`,
          },
          "input-push-token": 1,
        },
        10,
        START_EXPIRY_SECONDS,
      );
      if (delivered > 0) {
        report.started += 1;
      } else if (transient > 0) {
        await releaseSession(userId, key); // let the next refresh retry
      }
    }

    // Anything we track that is no longer wanted is over: the event went
    // final, the skater skated, or the user unfollowed.
    for (const [sessionKey, session] of sessions) {
      if (session.user_id !== userId || wanted.has(session.activity_key)) continue;
      const updateTo = updateTokens.get(sessionKey) ?? [];
      if (updateTo.length > 0) {
        const { delivered, transient } = await sendAll(
          updateTo,
          {
            event: "end",
            "content-state": endedState(session.last_state, now),
            "dismissal-date": nowSec + DISMISS_AFTER_SECONDS,
          },
          5,
          END_EXPIRY_SECONDS,
        );
        if (delivered === 0 && transient > 0) continue; // retry on the next refresh
      } else if (now - Date.parse(session.started_at) < ORPHAN_SESSION_MS) {
        continue; // no token yet; the app may still upload one, so keep the session open for now
      }
      report.ended += 1;
      sessionRows.push({
        user_id: userId,
        competition_slug: slug,
        activity_key: session.activity_key,
        last_state: session.last_state,
        updated_at: nowIso,
        ended_at: nowIso,
      });
    }
  };

  await mapLimit(userIds, deps.concurrency ?? 8, reconcileUser);

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
