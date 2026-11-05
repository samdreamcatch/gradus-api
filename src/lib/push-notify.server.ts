/**
 * Push notifications to users (PRD §6.6 "Triggers" and "Payload shape").
 *
 * `notifyUsers` resolves each user's iOS device tokens, builds the APNs
 * payload for each recipient (it names them in `gradus.uid`), sends every
 * token in parallel, and deletes tokens APNs reports as dead. It never throws and never blocks the calling action beyond the
 * `inBackground` contract in `background.ts` — a push failure never fails a
 * message send, a plan activation, or a webhook (PRD §4.1 rule 7).
 *
 * Recipient helpers live here too so every trigger resolves "the athlete's
 * household" the same way: the athlete's own login (self-managed or minor
 * with a username), the primary parent, and co-guardians only while the
 * primary parent's Team plan is active (mirrors `guardianAthleteAccess`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  apnsConfigFromEnv,
  sendApnsRequest,
  type ApnsConfig,
  type ApnsPushType,
  type ApnsRequest,
} from "./apns.server";
import { recordNotifications } from "./notifications.server";
import { teamPlanActive } from "./team.server";

type Admin = SupabaseClient<Database>;

export type PushMessage = {
  /** `gradus.type`, e.g. `message`, `plan_assigned`, `lesson_reminder`. */
  type: string;
  /** `gradus.route`, a path `RouteParser.route(fromPath:)` understands: `rooms/<id>`, `plans/<id>`, `coach/roster`, `settings/plan`, `recaps/<id>`. */
  route: string;
  title?: string;
  body?: string;
  /**
   * Stacks notifications in Notification Center (e.g. `room:<id>`); each one
   * still shows. The inbox doesn't group on it: every message is its own row.
   */
  threadId?: string;
  /**
   * `aps.category`: the notification category the apps register, which adds
   * its actions (PRD §6.6). `GRADUS_MESSAGE` carries a text Reply on iPhone
   * and Apple Watch (decision #54). Builds that don't know a category ignore it.
   */
  category?: string;
  /** Newer pushes with the same id replace older undelivered ones. */
  collapseId?: string;
  /** Background push: no alert, `content-available: 1`, low priority. The app refreshes silently. */
  silent?: boolean;
  /** How long APNs keeps trying while the phone is offline. Alerts default to a day; silent pushes to "once". */
  expiresInSeconds?: number;
  /** Inbox only: who caused it (the coach who assigned a plan, the sender). */
  actorUserId?: string;
  /** Inbox only: the athlete it is about, so the row goes when the athlete does. */
  athleteId?: string;
  /** `false` keeps an alert out of the in-app inbox. Silent pushes never go in. */
  inbox?: boolean;
};

/** Category for a message in a room: the apps add a text Reply action (decision #54). */
export const MESSAGE_CATEGORY = "GRADUS_MESSAGE";

/**
 * A message posted in a room (PRD §6.6 "New message in a room"): opens the
 * room, groups by room in Notification Center, and carries the Reply
 * category. Every trigger that posts a real message into a room builds its
 * push here, so none can leave the category out.
 */
export function roomMessagePush(roomId: string, title: string, body: string): PushMessage {
  return {
    type: "message",
    route: `rooms/${roomId}`,
    title,
    body,
    threadId: `room:${roomId}`,
    category: MESSAGE_CATEGORY,
  };
}

/** Rink phones are offline for hours at a time; an alert is still worth delivering the same day. */
export const DEFAULT_ALERT_EXPIRY_SECONDS = 24 * 60 * 60;

export type PushReport = {
  recipients: number;
  tokens: number;
  sent: number;
  failed: number;
  pruned: number;
  skipped?: "no_config" | "no_recipients" | "no_tokens";
};

export type PushDeps = {
  /** `undefined` = read from the environment; `null` = APNs not configured. */
  config?: ApnsConfig | null;
  send?: typeof sendApnsRequest;
};

/** Notification Center shows about this much of a body before truncating. */
const BODY_LIMIT = 160;

export function truncateBody(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > BODY_LIMIT ? `${oneLine.slice(0, BODY_LIMIT - 1)}…` : oneLine;
}

/**
 * The exact APNs JSON for a message (PRD §6.6 "Payload shape"), addressed to
 * `recipientUserId` when given. `gradus.uid` lets the apps refuse a Reply or a
 * tap on a notification left over from another account on the same phone
 * (household members share rooms, so the server alone can't tell).
 */
export function pushPayload(
  message: PushMessage,
  recipientUserId?: string,
): {
  payload: Record<string, unknown>;
  pushType: ApnsPushType;
  priority: 5 | 10;
} {
  const gradus = {
    type: message.type,
    route: message.route,
    v: 1,
    ...(recipientUserId ? { uid: recipientUserId } : {}),
  };
  if (message.silent) {
    return {
      payload: { aps: { "content-available": 1 }, gradus },
      pushType: "background",
      priority: 5,
    };
  }
  const aps: Record<string, unknown> = {
    alert: {
      ...(message.title ? { title: message.title } : {}),
      body: message.body ? truncateBody(message.body) : "",
    },
    sound: "default",
  };
  if (message.threadId) aps["thread-id"] = message.threadId;
  if (message.category) aps.category = message.category;
  return { payload: { aps, gradus }, pushType: "alert", priority: 10 };
}

let warnedNoConfig = false;

/**
 * Send `message` to every iOS device of every user in `userIds`. Duplicates
 * and empty ids are ignored. Dead tokens are deleted. Never throws.
 */
export async function notifyUsers(
  admin: Admin,
  userIds: Iterable<string>,
  message: PushMessage,
  deps: PushDeps = {},
): Promise<PushReport> {
  const ids = Array.from(new Set(Array.from(userIds).filter((id) => !!id)));
  const report: PushReport = { recipients: ids.length, tokens: 0, sent: 0, failed: 0, pruned: 0 };
  if (ids.length === 0) return { ...report, skipped: "no_recipients" };
  // The inbox row comes first and doesn't depend on APNs config or tokens, so
  // a user with push off still sees it in the app. Never throws.
  const inboxTitle = message.title ?? message.body;
  if (!message.silent && message.inbox !== false && inboxTitle) {
    await recordNotifications(admin, ids, {
      type: message.type,
      title: inboxTitle,
      body: message.title ? message.body : undefined,
      route: message.route,
      collapseKey: message.collapseId,
      actorUserId: message.actorUserId,
      athleteId: message.athleteId,
    });
  }
  try {
    return await notifyUsersUnguarded(admin, ids, message, deps, report);
  } catch (err) {
    // "Never throws" is the contract every trigger relies on.
    console.error("[push] notifyUsers failed", err instanceof Error ? err.message : err);
    return report;
  }
}

async function notifyUsersUnguarded(
  admin: Admin,
  ids: string[],
  message: PushMessage,
  deps: PushDeps,
  report: PushReport,
): Promise<PushReport> {
  const config = deps.config === undefined ? apnsConfigFromEnv() : deps.config;
  if (!config) {
    if (!warnedNoConfig) {
      warnedNoConfig = true;
      console.warn(
        "[push] APNs is not configured (APNS_KEY_P8 / APNS_KEY_ID / APPLE_TEAM_ID); pushes are skipped",
      );
    }
    return { ...report, skipped: "no_config" };
  }

  const tokensRes = await admin
    .from("device_tokens")
    .select("token, user_id")
    .in("user_id", ids)
    .eq("platform", "ios");
  if (tokensRes.error) {
    console.error("[push] device_tokens lookup failed", tokensRes.error);
    return report;
  }
  const tokens = (tokensRes.data ?? []) as { token: string; user_id: string }[];
  report.tokens = tokens.length;
  if (tokens.length === 0) return { ...report, skipped: "no_tokens" };

  // One payload per recipient: each names its own user in `gradus.uid`.
  const built = new Map<string, ReturnType<typeof pushPayload>>();
  const payloadFor = (userId: string) => {
    let entry = built.get(userId);
    if (!entry) {
      entry = pushPayload(message, userId);
      built.set(userId, entry);
    }
    return entry;
  };
  const send = deps.send ?? sendApnsRequest;
  const ttl = message.expiresInSeconds ?? (message.silent ? 0 : DEFAULT_ALERT_EXPIRY_SECONDS);
  const expiration = ttl > 0 ? Math.floor(Date.now() / 1000) + ttl : 0;
  const outcomes = await Promise.all(
    tokens.map(async (row) => {
      const { payload, pushType, priority } = payloadFor(row.user_id);
      const req: ApnsRequest = {
        token: row.token,
        payload,
        pushType,
        priority,
        expiration,
        ...(message.collapseId ? { collapseId: message.collapseId } : {}),
      };
      return { row, outcome: await send(config, req) };
    }),
  );

  const dead: string[] = [];
  for (const { row, outcome } of outcomes) {
    if (outcome.ok) {
      report.sent += 1;
      continue;
    }
    report.failed += 1;
    if (outcome.dead) dead.push(row.token);
    else
      console.warn("[push] send failed", {
        status: outcome.status,
        reason: outcome.reason,
        type: message.type,
      });
  }

  if (dead.length) {
    const del = await admin.from("device_tokens").delete().in("token", dead);
    if (del.error) console.error("[push] pruning dead tokens failed", del.error);
    else report.pruned = dead.length;
  }
  return report;
}

/* ------------------------------------------------------------- recipients */

export async function coachUserId(admin: Admin, coachId: string): Promise<string | null> {
  const res = await admin.from("coach_profiles").select("user_id").eq("id", coachId).maybeSingle();
  return (res.data as { user_id: string } | null)?.user_id ?? null;
}

export async function parentUserId(admin: Admin, parentId: string): Promise<string | null> {
  const res = await admin
    .from("parent_profiles")
    .select("user_id")
    .eq("id", parentId)
    .maybeSingle();
  return (res.data as { user_id: string } | null)?.user_id ?? null;
}

/**
 * Everyone who should hear about something that happened to an athlete:
 * the athlete's own account (if they have a login), the primary parent, and
 * co-guardians while the primary parent's Team plan is active.
 */
export async function athleteHouseholdUserIds(
  admin: Admin,
  athleteId: string,
  opts: { includeAthlete?: boolean } = {},
): Promise<string[]> {
  const athleteRes = await admin
    .from("athletes")
    .select("user_id, parent_id")
    .eq("id", athleteId)
    .maybeSingle();
  const athlete = athleteRes.data as { user_id: string | null; parent_id: string | null } | null;
  if (!athlete) return [];

  const out = new Set<string>();
  if (opts.includeAthlete !== false && athlete.user_id) out.add(athlete.user_id);

  if (athlete.parent_id) {
    const primary = await parentUserId(admin, athlete.parent_id);
    if (primary) out.add(primary);

    if (await teamPlanActive(admin, athlete.parent_id)) {
      const co = await admin
        .from("athlete_guardians")
        .select("parent_id")
        .eq("athlete_id", athleteId);
      const coParentIds = ((co.data ?? []) as { parent_id: string }[])
        .map((r) => r.parent_id)
        .filter((id) => id !== athlete.parent_id);
      if (coParentIds.length) {
        const users = await admin.from("parent_profiles").select("user_id").in("id", coParentIds);
        for (const r of (users.data ?? []) as { user_id: string }[]) out.add(r.user_id);
      }
    }
  }
  return Array.from(out);
}

/** Drop anyone who blocked the sender, or whom the sender blocked. */
export async function withoutBlocked(
  admin: Admin,
  senderUserId: string,
  userIds: string[],
): Promise<string[]> {
  const candidates = userIds.filter((id) => id !== senderUserId);
  if (candidates.length === 0) return [];
  const [theyBlocked, iBlocked] = await Promise.all([
    admin
      .from("user_blocks")
      .select("blocker_user_id")
      .eq("blocked_user_id", senderUserId)
      .in("blocker_user_id", candidates),
    admin
      .from("user_blocks")
      .select("blocked_user_id")
      .eq("blocker_user_id", senderUserId)
      .in("blocked_user_id", candidates),
  ]);
  const excluded = new Set<string>();
  for (const r of (theyBlocked.data ?? []) as { blocker_user_id: string }[])
    excluded.add(r.blocker_user_id);
  for (const r of (iBlocked.data ?? []) as { blocked_user_id: string }[])
    excluded.add(r.blocked_user_id);
  return candidates.filter((id) => !excluded.has(id));
}
