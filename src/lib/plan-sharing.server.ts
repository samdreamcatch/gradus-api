/**
 * One plan for several athletes (PRD decision #66, §7.3 "A plan for several
 * athletes"): giving each athlete their own copy, and sending the coach's
 * later changes to the copies they choose.
 *
 * The plan the coach keeps editing has no athlete; each copy is an ordinary
 * plan row for one athlete with `shared_from_id` pointing back at it. The
 * rules for "custom edits", "behind", and "what changed" are the pure ones in
 * `plan-sharing.ts`; this module reads and writes the rows.
 *
 * Every read and write goes through the caller's RLS client (a coach only
 * touches plans they own, for athletes on their roster). Writes are batched
 * and reads are paged (`db-batch.ts`): the number of requests grows with the
 * squad only by one per hundred athletes or thousand rows, never one per
 * athlete, so a large squad stays inside the Worker's request limit, the
 * database's row cap, and the gateway's URL length.
 * Notifications run after the response, as every other trigger does.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { chunks, eachLimited, readAll } from "./db-batch";
import { dbError } from "./db-error";
import { emptySessionsByState, loadSessionsByPlanIds } from "./plan-sessions.server";
import {
  diffContent,
  matchMoves,
  moveChange,
  parseContent,
  planContent,
  sameContent,
  type MoveChange,
  type PlanContent,
  type StoredMove,
} from "./plan-sharing";

type Client = SupabaseClient<Database>;

const notFound = () => new ApiError({ code: "not_found", status: 404, message: "Plan not found" });
const notOnRoster = () =>
  new ApiError({ code: "forbidden", status: 403, message: "Athlete is not on your roster" });

/** A coach's squad fits well inside this; it also bounds the batched writes. */
export const MAX_SHARE_ATHLETES = 200;

type MoveRow = StoredMove & { id: string; plan_id: string; position: number };
const MOVE_COLUMNS =
  "id, plan_id, position, move_id, name, description, cue, why, target_kind, target_value";

type PlanRow = {
  id: string;
  title: string;
  notes: string;
  kind: string;
  status: string;
  athlete_id: string | null;
  feedback_scope: string;
  shared_from_id: string | null;
  shared_synced: Json | null;
  shared_changes: Json | null;
};
const PLAN_COLUMNS =
  "id, title, notes, kind, status, athlete_id, feedback_scope, shared_from_id, shared_synced, shared_changes";

const alreadyHasCopy = () =>
  new ApiError({
    code: "conflict",
    status: 409,
    message: "One of these athletes was just given this plan. Open the plan again and retry.",
  });

function writeError(error: { message?: string; code?: string }): never {
  // The roster clause of the plans write policies is the only one that can
  // refuse a write scoped to the coach's own rows.
  if (error.code === "42501") throw notOnRoster();
  // `plans_one_copy_per_athlete`: a second request got there first.
  if (error.code === "23505") throw alreadyHasCopy();
  dbError(error);
}

async function loadMoves(supabase: Client, planIds: string[]): Promise<Map<string, MoveRow[]>> {
  const byPlan = new Map<string, MoveRow[]>(planIds.map((id) => [id, []]));
  // A squad's moves run past the row cap and the URL length at once (200
  // athletes with six moves each is 1,200 rows): a hundred plans at a time,
  // every page of each.
  for (const ids of chunks(planIds)) {
    const rows = await readAll<MoveRow>(
      (from, to) =>
        supabase
          .from("plan_moves")
          .select(MOVE_COLUMNS, { count: "exact" })
          .in("plan_id", ids)
          .order("plan_id", { ascending: true })
          .order("position", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: MoveRow[] | null;
          error: { message?: string; code?: string } | null;
          count: number | null;
        }>,
      dbError,
    );
    for (const row of rows) byPlan.get(row.plan_id)?.push(row);
  }
  for (const list of byPlan.values()) list.sort((a, b) => a.position - b.position);
  return byPlan;
}

async function loadCopies(supabase: Client, coachId: string, planId: string): Promise<PlanRow[]> {
  const rows = await readAll<PlanRow>(
    (from, to) =>
      supabase
        .from("plans")
        .select(PLAN_COLUMNS, { count: "exact" })
        .eq("shared_from_id", planId)
        .eq("coach_id", coachId)
        .eq("kind", "plan")
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: PlanRow[] | null;
        error: { message?: string; code?: string } | null;
        count: number | null;
      }>,
    dbError,
  );
  return rows.filter((c) => !!c.athlete_id);
}

/** Which of these athletes the coach coaches (one read, however many). */
async function rosteredAmong(
  supabase: Client,
  coachId: string,
  athleteIds: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const ids of chunks(Array.from(new Set(athleteIds)))) {
    const { data, error } = await supabase
      .from("coach_athletes")
      .select("athlete_id")
      .eq("coach_id", coachId)
      .in("athlete_id", ids);
    if (error) dbError(error);
    for (const r of data ?? []) found.add(r.athlete_id);
  }
  return found;
}

async function loadAthleteNames(supabase: Client, athleteIds: string[]) {
  const nameOf = new Map<string, string>();
  for (const ids of chunks(Array.from(new Set(athleteIds)))) {
    const { data, error } = await supabase
      .from("athletes")
      .select("id, first_name, last_name")
      .in("id", ids);
    if (error) dbError(error);
    for (const a of data ?? []) nameOf.set(a.id, `${a.first_name} ${a.last_name}`.trim());
  }
  return nameOf;
}

/* ---------------- reading: the list and the plan screen ---------------- */

/**
 * For the plans list: how many copies each of these plans has. Only plans
 * with at least one copy appear in the map.
 */
export async function loadCopyIdsByPlan(
  supabase: Client,
  coachId: string,
  planIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  type CopyRef = { id: string; shared_from_id: string | null; athlete_id: string | null };
  for (const ids of chunks(Array.from(new Set(planIds)))) {
    const rows = await readAll<CopyRef>(
      (from, to) =>
        supabase
          .from("plans")
          .select("id, shared_from_id, athlete_id", { count: "exact" })
          .eq("coach_id", coachId)
          .eq("kind", "plan")
          .in("shared_from_id", ids)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: CopyRef[] | null;
          error: { message?: string; code?: string } | null;
          count: number | null;
        }>,
      dbError,
    );
    for (const row of rows) {
      if (!row.shared_from_id || !row.athlete_id) continue;
      const list = map.get(row.shared_from_id);
      if (list) list.push(row.id);
      else map.set(row.shared_from_id, [row.id]);
    }
  }
  return map;
}

/** One athlete's copy, as the coach's plan screen lists it. */
export interface PlanShareDTO {
  athleteId: string;
  name: string;
  /** That athlete's copy: an ordinary plan the coach can open and edit. */
  planId: string;
  status: string;
  sessionsTotal: number;
  /** The coach changed this copy on its own since it last matched the plan. */
  tailored: boolean;
  /** The plan has changes this copy has not received. */
  behind: boolean;
}

/** One line of "what changed since the athletes last got this plan". */
export interface PendingChangeDTO {
  /** The plan's move it is about; null for a removed move or a change to the plan itself. */
  planMoveId: string | null;
  name: string;
  /** new, minutes, reps, changed, removed, title, notes, feedback, or order. */
  change: string;
}

export interface PlanShareInfo {
  sharedWith: PlanShareDTO[];
  pendingChanges: PendingChangeDTO[];
  /** Practice logged on the copies, summed, so the plan shows its athletes' work. */
  sessions: { sessionsByState: ReturnType<typeof emptySessionsByState>; sessionsTotal: number };
}

/**
 * The copies of a plan, for the coach's plan screen. Null when the plan has
 * none (it is an ordinary plan). `moves` are the plan's own, already loaded.
 */
export async function loadShareInfo(
  supabase: Client,
  coachId: string,
  plan: {
    id: string;
    title: string;
    notes: string;
    feedback_scope: string;
    shared_synced: Json | null;
  },
  moves: Array<StoredMove & { id: string }>,
): Promise<PlanShareInfo | null> {
  const copies = await loadCopies(supabase, coachId, plan.id);
  if (!copies.length) return null;

  const copyIds = copies.map((c) => c.id);
  const athleteIds = copies.map((c) => c.athlete_id as string);
  const [movesByCopy, sessionsByCopy, nameOf] = await Promise.all([
    loadMoves(supabase, copyIds),
    loadSessionsByPlanIds(supabase, copyIds),
    loadAthleteNames(supabase, athleteIds),
  ]);

  const current = planContent(plan, moves);
  const total = { sessionsByState: emptySessionsByState(), sessionsTotal: 0 };
  const sharedWith: PlanShareDTO[] = copies.map((copy) => {
    const received = parseContent(copy.shared_synced);
    const own = planContent(copy, movesByCopy.get(copy.id) ?? []);
    const sessions = sessionsByCopy.get(copy.id);
    if (sessions) {
      total.sessionsTotal += sessions.sessionsTotal;
      for (const key of Object.keys(total.sessionsByState) as Array<
        keyof typeof total.sessionsByState
      >) {
        total.sessionsByState[key] += sessions.sessionsByState[key];
      }
    }
    return {
      athleteId: copy.athlete_id as string,
      name: nameOf.get(copy.athlete_id as string) ?? "Athlete",
      planId: copy.id,
      status: copy.status,
      sessionsTotal: sessions?.sessionsTotal ?? 0,
      // Nothing recorded as received: no claim of custom edits, and the next update is offered.
      tailored: received ? !sameContent(own, received) : false,
      behind: !sameContent(current, received),
    };
  });
  sharedWith.sort((a, b) => a.name.localeCompare(b.name));

  const lastSent = parseContent(plan.shared_synced);
  const pendingChanges: PendingChangeDTO[] = lastSent
    ? diffContent(lastSent, current).map((c) => ({
        planMoveId: c.index === null ? null : (moves[c.index]?.id ?? null),
        name: c.name,
        change: c.change,
      }))
    : [];

  return { sharedWith, pendingChanges, sessions: total };
}

/* ---------------- telling the household ---------------- */

type Announcement = { athleteId: string; planId: string; title: string; wasDraft?: boolean };

/**
 * Plans went live for their athletes: the "Plan activated or assigned" push
 * and inbox row (PRD §6.6), and the existing guardian email copy for a parent
 * who has not joined. All of it runs after the response, and in bulk: the
 * households and device tokens are each read once for the whole squad, not
 * once per athlete. Dynamic imports keep the admin client and the push stack
 * out of the static graph of `plans.server.ts`, which the client bundle
 * reaches.
 */
export async function announcePlansActivated(coachId: string, plans: Announcement[]) {
  if (!plans.length) return;
  const { inBackground } = await import("./background");
  await inBackground("push:plan-activated", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { householdsUserIds, notifyMany } = await import("./push-notify.server");
    const households = await householdsUserIds(
      supabaseAdmin,
      plans.map((p) => p.athleteId),
    );
    await notifyMany(
      supabaseAdmin,
      plans.map((plan) => ({
        userIds: households.get(plan.athleteId) ?? [],
        message: {
          type: "plan_assigned",
          route: `plans/${plan.planId}`,
          title: plan.wasDraft === false ? "Plan activated" : "New plan",
          body: `${plan.title || "Untitled plan"} is ready to practice.`,
          collapseId: `plan:${plan.planId}`,
          athleteId: plan.athleteId,
        },
      })),
    );

    // The email copy goes only to a guardian on file who has not joined; one
    // read finds them, so a squad of joined families costs nothing more.
    const waiting = new Set<string>();
    for (const ids of chunks(Array.from(new Set(plans.map((p) => p.athleteId))))) {
      const { data } = await supabaseAdmin
        .from("athletes")
        .select("id")
        .in("id", ids)
        .is("parent_id", null)
        .is("guardian_claimed_at", null)
        .not("guardian_email", "is", null)
        .not("guardian_claim_token", "is", null);
      for (const row of data ?? []) waiting.add(row.id);
    }
    const toMirror = plans.filter((p) => waiting.has(p.athleteId));
    if (!toMirror.length) return;
    const { mirrorGuardianActivity } = await import("./guardian.server");
    await eachLimited(toMirror, 4, (plan) =>
      mirrorGuardianActivity({
        athleteId: plan.athleteId,
        senderRole: "coach",
        coachId,
        body: `Assigned a new plan: ${plan.title || "Untitled plan"}`,
      }),
    );
  });
}

/** The coach sent an update to a live copy (PRD §6.6 "Plan updated"). Push and inbox only: no email. */
async function announcePlansUpdated(plans: Announcement[]) {
  if (!plans.length) return;
  const { inBackground } = await import("./background");
  await inBackground("push:plan-updated", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { householdsUserIds, notifyMany } = await import("./push-notify.server");
    const households = await householdsUserIds(
      supabaseAdmin,
      plans.map((p) => p.athleteId),
    );
    await notifyMany(
      supabaseAdmin,
      plans.map((plan) => ({
        userIds: households.get(plan.athleteId) ?? [],
        message: {
          type: "plan_updated",
          route: `plans/${plan.planId}`,
          title: "Plan updated",
          body: `${plan.title || "Untitled plan"} has changes from your coach.`,
          collapseId: `plan:${plan.planId}`,
          athleteId: plan.athleteId,
        },
      })),
    );
  });
}

export type ShareAnnouncers = {
  activated: typeof announcePlansActivated;
  updated: typeof announcePlansUpdated;
};
const liveAnnouncers: ShareAnnouncers = {
  activated: announcePlansActivated,
  updated: announcePlansUpdated,
};

/* ---------------- giving the plan to several athletes ---------------- */

export const sharePlanInput = z.object({
  athleteIds: z
    .array(z.string().uuid())
    .min(1)
    .max(MAX_SHARE_ATHLETES)
    .describe(
      "The athletes who each get their own copy. An athlete who already has a copy of this plan is left as they are; nobody is removed by leaving them out.",
    ),
  activate: z
    .boolean()
    .describe(
      "true: the copies go live now and each athlete's household is told. false: the copies are saved as drafts for the coach to adjust first.",
    ),
});

const moveInsert = (planId: string, m: StoredMove, position: number) => ({
  plan_id: planId,
  position,
  move_id: m.move_id,
  name: m.name,
  description: m.description ?? "",
  cue: m.cue ?? "",
  why: m.why ?? "",
  target_kind: m.target_kind,
  target_value: Number(m.target_value),
});

/**
 * Gives each chosen athlete their own copy of a plan (or of a template).
 * Answers with the plan the coach keeps editing, which lists the copies:
 *
 *  - a template: a new plan made from it (the template stays in the Library);
 *  - a draft nobody has practised, or a plan with no athlete: that plan itself;
 *  - a plan one athlete is practising or has practised: a new plan made from
 *    it, and that athlete's plan stays theirs, history and all, as their copy;
 *  - one athlete's copy of a plan several athletes have: the plan it came
 *    from, so the new athletes join it instead of starting a second one.
 *
 * Safe to repeat: athletes who already have a copy are skipped, and a request
 * that fails after making a new plan takes that plan back.
 */
export async function sharePlanFor(
  supabase: Client,
  coachId: string,
  id: string,
  data: z.infer<typeof sharePlanInput>,
  now: Date = new Date(),
  announce: ShareAnnouncers = liveAnnouncers,
): Promise<{ id: string; shared: number }> {
  const { data: found, error } = await supabase
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("id", id)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (error) dbError(error);
  const plan = found as PlanRow | null;
  if (!plan) throw notFound();

  const athleteIds = Array.from(new Set(data.athleteIds));
  const rostered = await rosteredAmong(supabase, coachId, athleteIds);
  if (athleteIds.some((a) => !rostered.has(a))) throw notOnRoster();

  // One athlete's copy, opened on its own: the athletes join the plan it came from.
  if (plan.kind === "plan" && plan.athlete_id && plan.shared_from_id) {
    const { data: origin, error: originErr } = await supabase
      .from("plans")
      .select("id, athlete_id")
      .eq("id", plan.shared_from_id)
      .eq("coach_id", coachId)
      .eq("kind", "plan")
      .maybeSingle();
    if (originErr) dbError(originErr);
    if (origin && !origin.athlete_id) {
      return sharePlanFor(supabase, coachId, origin.id, data, now, announce);
    }
  }

  const moves = (await loadMoves(supabase, [plan.id])).get(plan.id) ?? [];
  const content = planContent(plan, moves);
  const synced = content as unknown as Json;
  const status = data.activate ? "active" : "draft";
  const stamp = now.toISOString();

  // 1. The plan the coach keeps editing.
  let sourceId = plan.id;
  let sourceStatus = plan.status;
  let sourceSynced = plan.shared_synced;
  const isLive = plan.status === "active" || plan.status === "benched";
  // A draft that was live once still carries its athlete's practice: it stays theirs too.
  const practised =
    plan.kind === "plan" && !!plan.athlete_id && (isLive || (await hasPractice(supabase, plan.id)));
  const needsNewSource = plan.kind === "template" || practised;
  if (needsNewSource) {
    const { data: created, error: createErr } = await supabase
      .from("plans")
      .insert({
        coach_id: coachId,
        title: plan.title,
        notes: plan.notes,
        kind: "plan",
        athlete_id: null,
        status: "draft",
        feedback_scope: plan.feedback_scope,
        shared_synced: synced,
      })
      .select("id")
      .single();
    if (createErr) writeError(createErr);
    sourceId = created.id;
    sourceStatus = "draft";
    sourceSynced = synced;
  }

  const createdIds: string[] = [];
  const announcements: Announcement[] = [];
  let shared = 0;
  let detached = false;
  try {
    if (!needsNewSource && (plan.athlete_id || plan.shared_from_id)) {
      // A draft for one athlete becomes the plan for all of them. Nothing was
      // practised on it, so that athlete, if still chosen, gets a copy below
      // like everyone else.
      const { data: cleared, error: clearErr } = await supabase
        .from("plans")
        .update({ athlete_id: null, shared_from_id: null, shared_synced: synced })
        .eq("id", plan.id)
        .eq("coach_id", coachId)
        .select("id");
      if (clearErr) writeError(clearErr);
      // No row and no error: the plan went away between the read and this write.
      if (!(cleared ?? []).length) throw notFound();
      detached = true;
      sourceSynced = synced;
    }
    if (needsNewSource) {
      if (moves.length) {
        const { error: movesErr } = await supabase
          .from("plan_moves")
          .insert(moves.map((m, i) => moveInsert(sourceId, m, i)));
        if (movesErr) dbError(movesErr);
      }
      // The athlete already practising it keeps their plan, now as their copy.
      // Only while it is still nobody's copy: of two requests racing to share
      // the same plan, the one that links it second finds no row, takes back
      // the plan it made (below), and the caller is told to retry, which then
      // adds to the first one's plan.
      if (plan.kind === "plan" && plan.athlete_id && athleteIds.includes(plan.athlete_id)) {
        const { data: linked, error: linkErr } = await supabase
          .from("plans")
          .update({ shared_from_id: sourceId, shared_synced: synced })
          .eq("id", plan.id)
          .eq("coach_id", coachId)
          .is("shared_from_id", null)
          .select("id");
        if (linkErr) writeError(linkErr);
        if (!(linked ?? []).length) throw alreadyHasCopy();
      }
    }

    // 2. A copy for everyone who does not have one yet.
    const existing = await loadCopies(supabase, coachId, sourceId);
    const hasCopy = new Set(existing.map((c) => c.athlete_id as string));
    const toCreate = athleteIds.filter((a) => !hasCopy.has(a));
    shared = hasCopy.size + toCreate.length;
    if (toCreate.length) {
      const { data: inserted, error: insErr } = await supabase
        .from("plans")
        .insert(
          toCreate.map((athleteId) => ({
            coach_id: coachId,
            title: plan.title,
            notes: plan.notes,
            kind: "plan",
            athlete_id: athleteId,
            status,
            feedback_scope: plan.feedback_scope,
            shared_from_id: sourceId,
            shared_synced: synced,
          })),
        )
        .select("id, athlete_id, shared_from_id");
      if (insErr) writeError(insErr);
      const created = (inserted ?? []) as Array<{
        id: string;
        athlete_id: string;
        shared_from_id: string | null;
      }>;
      createdIds.push(...created.map((c) => c.id));
      // The database drops a link to a plan that is gone or is no longer the
      // coach's athlete-less plan; a copy that lost its link is not a copy.
      if (created.some((c) => c.shared_from_id !== sourceId)) throw notFound();
      if (moves.length && created.length) {
        const { error: movesErr } = await supabase
          .from("plan_moves")
          .insert(created.flatMap((copy) => moves.map((m, i) => moveInsert(copy.id, m, i))));
        if (movesErr) dbError(movesErr);
      }
      if (data.activate) {
        for (const copy of created) {
          announcements.push({ athleteId: copy.athlete_id, planId: copy.id, title: plan.title });
        }
      }
    }

    // 3. The plan itself: live when its copies are, and it remembers what it sent.
    const sourcePatch: { updated_at: string; status?: string; shared_synced?: Json } = {
      updated_at: stamp,
    };
    if (data.activate && sourceStatus !== "active") sourcePatch.status = "active";
    if (!parseContent(sourceSynced)) sourcePatch.shared_synced = synced;
    const { error: srcErr } = await supabase
      .from("plans")
      .update(sourcePatch)
      .eq("id", sourceId)
      .eq("coach_id", coachId);
    if (srcErr) writeError(srcErr);
    // 4. Going live also takes the chosen athletes' waiting drafts live. Last, so a
    // failure before it leaves them drafts for the retry to take live and announce.
    if (data.activate) {
      const waiting = existing.filter(
        (c) => c.status === "draft" && athleteIds.includes(c.athlete_id as string),
      );
      for (const ids of chunks(waiting.map((c) => c.id))) {
        const { error: actErr } = await supabase
          .from("plans")
          .update({ status: "active" })
          .in("id", ids)
          .eq("coach_id", coachId)
          .eq("status", "draft");
        if (actErr) writeError(actErr);
      }
      for (const copy of waiting) {
        announcements.push({
          athleteId: copy.athlete_id as string,
          planId: copy.id,
          title: copy.title,
        });
      }
    }

  } catch (err) {
    // Nobody has been told yet. Copies made by this request go, so no athlete
    // is left holding an empty or half-made plan, and so does a plan made for
    // it: a retry then starts clean instead of making a second one. (The
    // practising athlete's own plan is only unlinked, by the database.)
    await takeBack(supabase, coachId, createdIds, needsNewSource ? sourceId : null);
    if (detached) {
      // The draft goes back to the athlete it was for.
      const { error: backErr } = await supabase
        .from("plans")
        .update({
          athlete_id: plan.athlete_id,
          shared_from_id: plan.shared_from_id,
          shared_synced: plan.shared_synced,
        })
        .eq("id", plan.id)
        .eq("coach_id", coachId);
      if (backErr) console.error("[plans] restoring a draft after a failed share failed", backErr);
    }
    throw err;
  }

  await announce.activated(coachId, announcements);
  return { id: sourceId, shared };
}

/** Whether any practice was ever logged on this plan. */
async function hasPractice(supabase: Client, planId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("plan_sessions")
    .select("id")
    .eq("plan_id", planId)
    .limit(1);
  if (error) dbError(error);
  return (data ?? []).length > 0;
}

/** Best-effort undo of a share that failed part-way; never throws over the original error. */
async function takeBack(
  supabase: Client,
  coachId: string,
  copyIds: string[],
  newSourceId: string | null,
) {
  try {
    for (const ids of chunks(copyIds)) {
      const { error } = await supabase.from("plans").delete().in("id", ids).eq("coach_id", coachId);
      if (error) console.error("[plans] undoing a failed share: copies not removed", error);
    }
    if (newSourceId) {
      const { error } = await supabase
        .from("plans")
        .delete()
        .eq("id", newSourceId)
        .eq("coach_id", coachId);
      if (error) console.error("[plans] undoing a failed share: plan not removed", error);
    }
  } catch (e) {
    console.error("[plans] undoing a failed share failed", e);
  }
}

/* ---------------- sending an update to chosen copies ---------------- */

export const updateCopiesInput = z.object({
  athleteIds: z
    .array(z.string().uuid())
    .min(1)
    .max(MAX_SHARE_ATHLETES)
    .describe(
      "The athletes whose copies are replaced with the plan as it is now. A copy the coach edited on its own loses those edits. Athletes left out keep their copy as it is.",
    ),
});

/**
 * Makes the chosen athletes' copies match the plan again. Moves that are
 * still in the plan keep their rows (so each move's practice ratings stay
 * attached); new ones are added, dropped ones removed. Each live copy that
 * actually changed tells its household once. Safe to repeat: a copy that
 * already matches and is marked as having received the plan is left alone,
 * and nobody is told twice.
 */
export async function updateCopiesFor(
  supabase: Client,
  coachId: string,
  id: string,
  data: z.infer<typeof updateCopiesInput>,
  now: Date = new Date(),
  announce: ShareAnnouncers = liveAnnouncers,
): Promise<{ ok: true; updated: number }> {
  const { data: found, error } = await supabase
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("id", id)
    .eq("coach_id", coachId)
    .eq("kind", "plan")
    .maybeSingle();
  if (error) dbError(error);
  const plan = found as PlanRow | null;
  if (!plan) throw notFound();

  const wanted = new Set(data.athleteIds);
  const copies = (await loadCopies(supabase, coachId, plan.id)).filter((c) =>
    wanted.has(c.athlete_id as string),
  );
  if (!copies.length) {
    throw new ApiError({
      code: "unprocessable",
      status: 422,
      message: "None of these athletes has a copy of this plan.",
    });
  }
  // A copy whose athlete has left the roster can no longer be edited; it is skipped.
  const rostered = await rosteredAmong(
    supabase,
    coachId,
    copies.map((c) => c.athlete_id as string),
  );
  const targets = copies.filter((c) => rostered.has(c.athlete_id as string));

  const movesByPlan = await loadMoves(supabase, [plan.id, ...targets.map((c) => c.id)]);
  const sourceMoves = movesByPlan.get(plan.id) ?? [];
  const content: PlanContent = planContent(plan, sourceMoves);
  const synced = content as unknown as Json;
  const stamp = now.toISOString();

  const upserts: Array<ReturnType<typeof moveInsert> & { id: string }> = [];
  const inserts: Array<ReturnType<typeof moveInsert>> = [];
  const deletes: string[] = [];
  /** copy id → (position in the plan → tag), resolved to move ids once the new rows have ids. */
  const tagged = new Map<string, Map<number, MoveChange>>();
  const keptIdAt = new Map<string, Map<number, string>>();
  const changed: PlanRow[] = [];
  const settled: PlanRow[] = [];

  for (const copy of targets) {
    const copyMoves = movesByPlan.get(copy.id) ?? [];
    const own = planContent(copy, copyMoves);
    if (sameContent(own, content)) {
      // Already what the plan says: only its "received" marker may be stale.
      if (!sameContent(parseContent(copy.shared_synced), content)) settled.push(copy);
      continue;
    }
    changed.push(copy);
    const match = matchMoves(own.moves, content.moves);
    const tags = new Map<number, MoveChange>();
    const kept = new Map<number, string>();
    sourceMoves.forEach((move, i) => {
      const j = match.fromIndex[i];
      if (j === null) {
        inserts.push(moveInsert(copy.id, move, i));
        tags.set(i, "new");
        return;
      }
      const row = copyMoves[j];
      kept.set(i, row.id);
      const change = moveChange(own.moves[j], content.moves[i]);
      if (change) tags.set(i, change);
      if (change || row.position !== i)
        upserts.push({ id: row.id, ...moveInsert(copy.id, move, i) });
    });
    for (const j of match.removed) deletes.push(copyMoves[j].id);
    tagged.set(copy.id, tags);
    keptIdAt.set(copy.id, kept);
  }

  for (const ids of chunks(deletes)) {
    const { error: delErr } = await supabase.from("plan_moves").delete().in("id", ids);
    if (delErr) dbError(delErr);
  }
  if (upserts.length) {
    const { error: upErr } = await supabase
      .from("plan_moves")
      .upsert(upserts, { onConflict: "id" });
    if (upErr) dbError(upErr);
  }
  const newIdAt = new Map<string, Map<number, string>>();
  if (inserts.length) {
    const { data: added, error: addErr } = await supabase
      .from("plan_moves")
      .insert(inserts)
      .select("id, plan_id, position");
    if (addErr) dbError(addErr);
    for (const row of added ?? []) {
      const at = newIdAt.get(row.plan_id) ?? new Map<number, string>();
      at.set(row.position, row.id);
      newIdAt.set(row.plan_id, at);
    }
  }

  // The copies' own rows, in one write: what they now say, what they received,
  // and what changed for the athlete's view.
  const planRows = [
    ...changed.map((copy) => {
      const moves: Record<string, MoveChange> = {};
      for (const [position, tag] of tagged.get(copy.id) ?? []) {
        const moveId = keptIdAt.get(copy.id)?.get(position) ?? newIdAt.get(copy.id)?.get(position);
        if (moveId) moves[moveId] = tag;
      }
      return {
        ...copyRow(coachId, plan, copy, synced, stamp),
        shared_changes: { at: stamp, moves } as unknown as Json,
      };
    }),
    // Every row carries the same columns: in one upsert a column a row leaves
    // out is written as NULL, which would wipe these copies' change tags.
    ...settled.map((copy) => ({
      ...copyRow(coachId, plan, copy, synced, stamp),
      shared_changes: copy.shared_changes,
    })),
  ];
  if (planRows.length) {
    const { error: rowsErr } = await supabase.from("plans").upsert(planRows, { onConflict: "id" });
    if (rowsErr) writeError(rowsErr);
  }

  // The plan remembers what it last sent, so "what changed" starts again from here.
  if (!sameContent(parseContent(plan.shared_synced), content)) {
    const { error: srcErr } = await supabase
      .from("plans")
      .update({ shared_synced: synced })
      .eq("id", plan.id)
      .eq("coach_id", coachId);
    if (srcErr) writeError(srcErr);
  }

  // A copy that already says what the plan says but was never marked as having
  // received it is one a failed attempt changed and did not finish: its
  // household is told now, so a retry never swallows the notification.
  await announce.updated(
    [...changed, ...settled]
      .filter((c) => c.status === "active")
      .map((c) => ({ athleteId: c.athlete_id as string, planId: c.id, title: plan.title })),
  );
  return { ok: true, updated: changed.length + settled.length };
}

/** A copy's row after an update: the plan's words, and what it has now received. */
function copyRow(coachId: string, plan: PlanRow, copy: PlanRow, synced: Json, stamp: string) {
  return {
    id: copy.id,
    coach_id: coachId,
    kind: "plan",
    athlete_id: copy.athlete_id,
    status: copy.status,
    title: plan.title,
    notes: plan.notes,
    feedback_scope: plan.feedback_scope,
    shared_from_id: plan.id,
    shared_synced: synced,
    updated_at: stamp,
  };
}

/* ---------------- status and delete follow the plan to its copies ---------------- */

/** A copy a status change moved: `status` is what it was before. */
export type MovedCopy = { id: string; athlete_id: string; title: string; status: string };

/**
 * The copies a status change on the plan carries with it:
 *  - going live takes the drafts live (or, when the plan was benched, brings
 *    back the copies benched with it);
 *  - benching or un-publishing takes the live copies down.
 * Returns the copies it moved, for the caller's notifications and "why" answers.
 */
export async function cascadeStatusToCopies(
  supabase: Client,
  coachId: string,
  planId: string,
  from: string,
  to: "active" | "benched" | "draft",
  /**
   * Filled as each batch of copies moves, so a caller that must tell
   * households (or record answers) can do it for the copies that did move
   * even when a later batch, or the caller's next write, fails.
   */
  movedSoFar: MovedCopy[] = [],
): Promise<MovedCopy[]> {
  const copies = await loadCopies(supabase, coachId, planId);
  if (!copies.length) return [];
  const moving =
    to === "active"
      ? copies.filter((c) => c.status === (from === "benched" ? "benched" : "draft"))
      : copies.filter((c) => c.status === "active");
  if (!moving.length) return [];
  // Only athletes still on the roster: the write policy refuses the rest.
  const rostered = await rosteredAmong(
    supabase,
    coachId,
    moving.map((c) => c.athlete_id as string),
  );
  const allowed = moving.filter((c) => rostered.has(c.athlete_id as string));
  if (!allowed.length) return [];
  for (const ids of chunks(allowed.map((c) => c.id))) {
    const { data, error } = await supabase
      .from("plans")
      .update({ status: to })
      .in("id", ids)
      .eq("coach_id", coachId)
      .select("id");
    if (error) writeError(error);
    const done = new Set((data ?? []).map((r) => r.id));
    movedSoFar.push(
      ...allowed
        .filter((c) => done.has(c.id))
        .map((c) => ({
          id: c.id,
          athlete_id: c.athlete_id as string,
          title: c.title,
          status: c.status,
        })),
    );
  }
  return movedSoFar;
}

/** Deleting a draft plan takes its draft copies with it; a copy that went live is kept. */
export async function deleteDraftCopies(supabase: Client, coachId: string, planId: string) {
  const { error } = await supabase
    .from("plans")
    .delete()
    .eq("shared_from_id", planId)
    .eq("coach_id", coachId)
    .eq("kind", "plan")
    .eq("status", "draft");
  if (error) dbError(error);
}

/* ---------------- the athlete's and parent's view ---------------- */

/**
 * What the coach's last update changed on this copy (plan move id → tag),
 * shown until the athlete next logs practice on the plan. Null when there is
 * nothing to show. `admin`: the caller's access to the plan is already checked.
 */
export async function loadUpdatedMoves(
  admin: Client,
  planId: string,
): Promise<Record<string, string> | null> {
  const { data, error } = await admin
    .from("plans")
    .select("shared_changes")
    .eq("id", planId)
    .maybeSingle();
  if (error) dbError(error);
  const raw = data?.shared_changes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { at, moves } = raw as { at?: unknown; moves?: unknown };
  if (typeof at !== "string" || !moves || typeof moves !== "object") return null;
  const tags: Record<string, string> = {};
  for (const [moveId, tag] of Object.entries(moves as Record<string, unknown>)) {
    if (typeof tag === "string") tags[moveId] = tag;
  }
  if (!Object.keys(tags).length) return null;
  const since = await admin
    .from("plan_sessions")
    .select("id")
    .eq("plan_id", planId)
    .gt("created_at", at)
    .limit(1);
  if (since.error) dbError(since.error);
  return (since.data ?? []).length ? null : tags;
}
