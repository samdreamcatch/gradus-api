// Server-only helper: gathers raw "user was active" signals used by both the
// daily-active-users chart and the admin active-user drill-down list, so the
// two can never drift apart.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

export type ActivityKind = "message" | "session" | "wrap_up" | "plan" | "resource";

export interface ActivityEvent {
  userId: string;
  at: string;
  kind: ActivityKind;
}

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  message: "Message sent",
  session: "Session logged",
  wrap_up: "Lesson wrap-up",
  plan: "Plan created",
  resource: "Resource uploaded",
};

/**
 * Load every activity event since `sinceISO`, resolved to auth user ids.
 * Test users are dropped unless `includeTest` is true.
 */
export async function loadActivityEvents(
  supabaseAdmin: Admin,
  sinceISO: string,
  includeTest: boolean,
): Promise<ActivityEvent[]> {
  const [messages, sessions, wrapUps, plansCreated, resourcesCreated] = await Promise.all([
    supabaseAdmin
      .from("messages")
      .select("sender_user_id, created_at")
      .gte("created_at", sinceISO)
      .limit(50000),
    supabaseAdmin
      .from("plan_sessions")
      .select("athlete_id, parent_id, logged_at")
      .gte("logged_at", sinceISO)
      .limit(50000),
    supabaseAdmin
      .from("lesson_wrap_ups")
      .select("coach_id, created_at")
      .gte("created_at", sinceISO)
      .limit(50000),
    supabaseAdmin
      .from("plans")
      .select("coach_id, created_at")
      .gte("created_at", sinceISO)
      .limit(50000),
    supabaseAdmin
      .from("resources")
      .select("coach_id, created_at")
      .gte("created_at", sinceISO)
      .not("coach_id", "is", null)
      .limit(50000),
  ]);

  const athleteIds = Array.from(
    new Set((sessions.data ?? []).map((s) => s.athlete_id).filter(Boolean) as string[]),
  );
  const parentProfileIds = Array.from(
    new Set((sessions.data ?? []).map((s) => s.parent_id).filter(Boolean) as string[]),
  );
  const coachIds = Array.from(
    new Set(
      [
        ...(wrapUps.data ?? []).map((w) => w.coach_id),
        ...(plansCreated.data ?? []).map((p) => p.coach_id),
        ...(resourcesCreated.data ?? []).map((r) => r.coach_id),
      ].filter(Boolean) as string[],
    ),
  );

  const athleteUserMap = new Map<string, string>();
  if (athleteIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("athletes")
      .select("id, user_id")
      .in("id", athleteIds);
    for (const a of data ?? []) if (a.user_id) athleteUserMap.set(a.id, a.user_id);
  }

  const parentUserMap = new Map<string, string>();
  if (parentProfileIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("parent_profiles")
      .select("id, user_id")
      .in("id", parentProfileIds);
    for (const p of data ?? []) if (p.user_id) parentUserMap.set(p.id, p.user_id);
  }

  const coachUserMap = new Map<string, string>();
  if (coachIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("coach_profiles")
      .select("id, user_id")
      .in("id", coachIds);
    for (const c of data ?? []) if (c.user_id) coachUserMap.set(c.id, c.user_id);
  }

  const testUsers = new Set<string>();
  if (!includeTest) {
    const [{ data: testCoaches }, { data: testParents }, { data: testAthletes }] =
      await Promise.all([
        supabaseAdmin.from("coach_profiles").select("user_id").eq("is_test", true),
        supabaseAdmin.from("parent_profiles").select("user_id").eq("is_test", true),
        supabaseAdmin.from("athletes").select("user_id").eq("is_test", true),
      ]);
    for (const r of testCoaches ?? []) if (r.user_id) testUsers.add(r.user_id);
    for (const r of testParents ?? []) if (r.user_id) testUsers.add(r.user_id);
    for (const r of testAthletes ?? []) if (r.user_id) testUsers.add(r.user_id);
  }

  const events: ActivityEvent[] = [];
  const push = (
    userId: string | null | undefined,
    at: string | null | undefined,
    kind: ActivityKind,
  ) => {
    if (!userId || !at) return;
    if (!includeTest && testUsers.has(userId)) return;
    events.push({ userId, at, kind });
  };

  for (const m of messages.data ?? []) {
    if (!m.sender_user_id) continue;
    push(m.sender_user_id, m.created_at, "message");
  }
  for (const s of sessions.data ?? []) {
    if (s.parent_id) push(parentUserMap.get(s.parent_id), s.logged_at, "session");
    else push(athleteUserMap.get(s.athlete_id), s.logged_at, "session");
  }
  for (const w of wrapUps.data ?? []) push(coachUserMap.get(w.coach_id), w.created_at, "wrap_up");
  for (const p of plansCreated.data ?? []) {
    if (p.coach_id) push(coachUserMap.get(p.coach_id), p.created_at, "plan");
  }
  for (const r of resourcesCreated.data ?? []) {
    if (r.coach_id) push(coachUserMap.get(r.coach_id), r.created_at, "resource");
  }

  return events;
}
