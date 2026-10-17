/**
 * Re-dating the App Review demo athlete's activity (`demo-activity.ts`), so
 * the coach's pre-lesson briefing always has the last two weeks to report.
 *
 * Called three ways: the seeder and the "Refresh activity" button
 * (admin-demo-accounts.functions.ts), and once a day by pg_cron (see the
 * `demo-activity-daily` migration) via `POST /api/public/hooks/demo-activity`,
 * which looks for the default demo accounts (`DEMO_ACCOUNT_DEFAULTS`).
 *
 * Test rows only: the coach, the athlete and the athlete's parent must all
 * be `is_test`. A real account that happens to use a demo email or username
 * is refused, never changed.
 */
import { dbError } from "./db-error";
import {
  DEMO_ACCOUNT_DEFAULTS,
  DEMO_MESSAGES,
  DEMO_SESSIONS,
  demoTimestamp,
  type DemoMessage,
} from "./demo-activity";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/** No demo coach or athlete under these sign-ins yet: nothing to change. */
export class DemoAccountsMissing extends Error {
  constructor() {
    super("Create the demo accounts first");
    this.name = "DemoAccountsMissing";
  }
}

const NOT_TEST = "These aren't demo accounts: only test rows can be changed here";

export async function findUserIdByEmail(admin: AnyClient, email: string): Promise<string | null> {
  // The admin API has no lookup by email; the user base is small enough to page.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 500 });
    if (error) throw new Error(error.message);
    const hit = (data?.users ?? []).find(
      (u: { email?: string | null }) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
    );
    if (hit) return hit.id as string;
    if ((data?.users ?? []).length < 500) break;
  }
  return null;
}

export type DemoAccounts = {
  coachId: string;
  coachUserId: string;
  athleteId: string;
  athleteUserId: string | null;
  parentId: string | null;
};

/**
 * The existing demo coach and athlete, for the actions that change them in
 * place. Test rows only: a real coach or athlete under these sign-ins is
 * refused.
 */
export async function existingDemoAccounts(
  admin: AnyClient,
  input: { coachEmail: string; athleteUsername: string },
): Promise<DemoAccounts> {
  const coachUserId = await findUserIdByEmail(admin, input.coachEmail);
  const coach = coachUserId
    ? await admin
        .from("coach_profiles")
        .select("id, is_test")
        .eq("user_id", coachUserId)
        .maybeSingle()
    : { data: null, error: null };
  if (coach.error) dbError(coach.error);
  const athlete = await admin
    .from("athletes")
    .select("id, user_id, parent_id, is_test")
    .eq("username", input.athleteUsername)
    .maybeSingle();
  if (athlete.error) dbError(athlete.error);
  if (!coachUserId || !coach.data || !athlete.data) throw new DemoAccountsMissing();
  if (!coach.data.is_test || !athlete.data.is_test) throw new Error(NOT_TEST);
  return {
    coachId: coach.data.id as string,
    coachUserId,
    athleteId: athlete.data.id as string,
    athleteUserId: (athlete.data.user_id as string | null) ?? null,
    parentId: (athlete.data.parent_id as string | null) ?? null,
  };
}

/**
 * Write the demo activity (`demo-activity.ts`) dated from `now`. Rows that
 * are already there, found by their text, move to the new date; missing
 * ones are inserted. Running it again never adds duplicates.
 */
export async function writeDemoActivity(
  admin: AnyClient,
  ids: {
    planId: string;
    athleteId: string;
    roomId: string;
    senders: Record<DemoMessage["sender"], string>;
  },
  now: Date,
): Promise<void> {
  const sessionsRes = await admin
    .from("plan_sessions")
    .select("id, note")
    .eq("plan_id", ids.planId)
    .in(
      "note",
      DEMO_SESSIONS.map((s) => s.note),
    );
  if (sessionsRes.error) dbError(sessionsRes.error);
  const sessionIdByNote = new Map<string, string>();
  for (const r of (sessionsRes.data ?? []) as { id: string; note: string }[]) {
    if (!sessionIdByNote.has(r.note)) sessionIdByNote.set(r.note, r.id);
  }
  const newSessions = [];
  for (const s of DEMO_SESSIONS) {
    const fields = {
      logged_at: demoTimestamp(now, s.daysAgo, s.hourUtc),
      state_index: s.state,
      duration_seconds: s.minutes * 60,
    };
    const id = sessionIdByNote.get(s.note);
    if (id) {
      const moved = await admin.from("plan_sessions").update(fields).eq("id", id);
      if (moved.error) dbError(moved.error);
    } else {
      newSessions.push({
        ...fields,
        plan_id: ids.planId,
        athlete_id: ids.athleteId,
        parent_id: null,
        note: s.note,
      });
    }
  }
  if (newSessions.length) {
    const added = await admin.from("plan_sessions").insert(newSessions);
    if (added.error) dbError(added.error);
  }

  const messagesRes = await admin
    .from("messages")
    .select("id, body")
    .eq("room_id", ids.roomId)
    .in(
      "body",
      DEMO_MESSAGES.map((m) => m.body),
    );
  if (messagesRes.error) dbError(messagesRes.error);
  const messageIdByBody = new Map<string, string>();
  for (const r of (messagesRes.data ?? []) as { id: string; body: string }[]) {
    if (!messageIdByBody.has(r.body)) messageIdByBody.set(r.body, r.id);
  }
  const newMessages = [];
  for (const m of DEMO_MESSAGES) {
    const createdAt = demoTimestamp(now, m.daysAgo, m.hourUtc, m.minute);
    const id = messageIdByBody.get(m.body);
    if (id) {
      const moved = await admin.from("messages").update({ created_at: createdAt }).eq("id", id);
      if (moved.error) dbError(moved.error);
    } else {
      newMessages.push({
        sender_user_id: ids.senders[m.sender],
        sender_role: m.sender,
        body: m.body,
        created_at: createdAt,
        kind: "text",
        room_id: ids.roomId,
        direct_room_id: null,
        plan_id: null,
        audio_url: null,
        duration_seconds: null,
      });
    }
  }
  if (newMessages.length) {
    const added = await admin.from("messages").insert(newMessages);
    if (added.error) dbError(added.error);
  }
}

/**
 * Bring the existing demo athlete's practice sessions and conversation back
 * into the last two weeks, without resetting the accounts. The parent who
 * "sends" the parent messages is the athlete's own parent, and must be a
 * test row too.
 */
export async function refreshDemoActivity(
  admin: AnyClient,
  input: { coachEmail: string; athleteUsername: string },
  now: Date,
): Promise<{ sessions: number; messages: number }> {
  const demo = await existingDemoAccounts(admin, input);
  const { coachId, athleteId } = demo;
  if (!demo.athleteUserId || !demo.parentId) throw new DemoAccountsMissing();

  const parent = await admin
    .from("parent_profiles")
    .select("user_id, is_test")
    .eq("id", demo.parentId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (!parent.data?.user_id) throw new DemoAccountsMissing();
  if (!parent.data.is_test) throw new Error(NOT_TEST);

  const plan = await admin
    .from("plans")
    .select("id")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .eq("kind", "plan")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (plan.error) dbError(plan.error);
  if (!plan.data) {
    throw new Error("The demo athlete has no active plan: reset the demo accounts");
  }

  const room = await admin
    .from("message_rooms")
    .select("id")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (room.error) dbError(room.error);
  let roomId = room.data?.id as string | undefined;
  if (!roomId) {
    const created = await admin
      .from("message_rooms")
      .insert({ coach_id: coachId, athlete_id: athleteId })
      .select("id")
      .single();
    if (created.error) dbError(created.error);
    roomId = created.data.id as string;
  }

  await writeDemoActivity(
    admin,
    {
      planId: plan.data.id as string,
      athleteId,
      roomId,
      senders: {
        coach: demo.coachUserId,
        parent: parent.data.user_id as string,
        athlete: demo.athleteUserId,
      },
    },
    now,
  );
  return { sessions: DEMO_SESSIONS.length, messages: DEMO_MESSAGES.length };
}

export type DemoActivityHookResult =
  | { refreshed: true; sessions: number; messages: number }
  | { refreshed: false; reason: string };

/**
 * The daily run: refresh the default demo accounts, or do nothing when they
 * haven't been created. Anything else (a non-test row, a missing plan, a
 * database error) throws, so the hook answers 500.
 */
export async function runDemoActivityRefresh(
  ctx: { admin: AnyClient },
  now: Date = new Date(),
): Promise<DemoActivityHookResult> {
  try {
    const counts = await refreshDemoActivity(ctx.admin, DEMO_ACCOUNT_DEFAULTS, now);
    return { refreshed: true, ...counts };
  } catch (error) {
    if (error instanceof DemoAccountsMissing) return { refreshed: false, reason: error.message };
    throw error;
  }
}
