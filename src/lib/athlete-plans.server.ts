/**
 * A self-managed or claimed athlete's own plans (PRD §7.8): the active and
 * benched plans assigned to them (seeding the Gradus starter programs on
 * first read) and one plan's detail. Single source of truth for
 * athlete-plans.functions.ts and `GET /api/v1/athlete/plans`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SessionsByState } from "@/components/plans/flow-state-bars";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { emptySessionsByState, loadSessionsByPlanIds } from "./plan-sessions.server";

type Client = SupabaseClient<Database>;

export type AthletePlansContext = {
  userId: string;
  supabase: Client;
  admin: Client;
  /**
   * Include the plans the athlete wrote (PRD §6.14). Off by default: the web
   * pages that call this module know nothing of them (§4.1 zero disruption), so
   * only the `/api/v1` routes turn it on.
   */
  includeAuthored?: boolean;
};

export type AthletePlanStatus = "active" | "benched";
export type TargetKind = "reps" | "mins";

export interface AthletePlanSummaryDTO {
  id: string;
  title: string;
  status: AthletePlanStatus;
  coachId: string;
  /** For a plan the athlete wrote, the athlete's own first name (there is no coach). */
  coachName: string;
  isGradus: boolean;
  sport: string;
  moveCount: number;
  totalMinutes: number;
  updatedAt: string;
  sessionsByState: SessionsByState;
  sessionsTotal: number;
  /** `plans.source` as a plain string (never an enum on the wire); `"athlete"` marks the athlete's own plans so a client never captions them "from Gradus". Optional so an older server decodes. */
  source?: string;
}

/** An unfinished plan the athlete wrote (a voice-built draft, a blank "+"), listed only to its author. */
export interface AthleteDraftSummaryDTO {
  id: string;
  title: string;
  status: "draft";
  source: string;
  moveCount: number;
  totalMinutes: number;
  updatedAt: string;
}

export interface AthletePlanMoveDTO {
  id: string;
  position: number;
  name: string;
  description: string;
  cue: string;
  why: string;
  targetKind: TargetKind;
  targetValue: number;
}

export interface AthletePlanDetailDTO {
  id: string;
  title: string;
  notes: string;
  status: AthletePlanStatus;
  athleteId: string;
  athleteFirstName: string;
  coachId: string;
  coachName: string;
  coachFirstName: string;
  isGradus: boolean;
  moveCount: number;
  totalMinutes: number;
  updatedAt: string;
  moves: AthletePlanMoveDTO[];
  source?: string;
}

export interface AthletePlansDTO {
  athlete: { id: string; firstName: string };
  plans: AthletePlanSummaryDTO[];
  /** The athlete's own drafts; omitted by a server that predates athlete-authored plans. */
  drafts?: AthleteDraftSummaryDTO[];
}

const notFound = () => new ApiError({ code: "not_found", status: 404, message: "Plan not found" });

async function findMyAthleteRow(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("athletes")
    .select("id, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  return data;
}

/* ---------------- list ---------------- */

export async function listAthletePlans(ctx: AthletePlansContext): Promise<AthletePlansDTO> {
  const { supabase, admin } = ctx;
  const athlete = await findMyAthleteRow(supabase, ctx.userId);
  if (!athlete) return { athlete: { id: "", firstName: "" }, plans: [] };

  const { ensureStarterProgramsForAthlete } = await import("./starter-programs.server");
  await ensureStarterProgramsForAthlete(athlete.id);

  const planQuery = supabase
    .from("plans")
    .select("id, title, status, coach_id, updated_at, source")
    .eq("athlete_id", athlete.id)
    .eq("kind", "plan")
    .in("status", ["active", "benched"]);
  // Active/benched plans the athlete owns (incl. imported shared plans) show everywhere;
  // only their drafts stay API-only (listed below).
  const { data: planRows, error: pErr } = await planQuery.order("updated_at", {
    ascending: false,
  });
  if (pErr) dbError(pErr);

  const plans = planRows ?? [];
  const me = { id: athlete.id, firstName: athlete.first_name };

  // The athlete's own unfinished plans, listed to them alone (never to the web).
  let drafts: { id: string; title: string; updated_at: string }[] = [];
  if (ctx.includeAuthored) {
    const { data: draftRows, error: dErr } = await supabase
      .from("plans")
      .select("id, title, updated_at")
      .eq("athlete_id", athlete.id)
      .eq("source", "athlete")
      .eq("kind", "plan")
      .eq("status", "draft")
      .order("updated_at", { ascending: false });
    if (dErr) dbError(dErr);
    drafts = draftRows ?? [];
  }

  if (!plans.length && !drafts.length) {
    return ctx.includeAuthored
      ? { athlete: me, plans: [], drafts: [] }
      : { athlete: me, plans: [] };
  }

  const planIds = [...plans.map((p) => p.id), ...drafts.map((d) => d.id)];
  const coachIds = Array.from(
    new Set(plans.map((p) => p.coach_id).filter((v): v is string => !!v)),
  );

  const [movesRes, coachesRes, goalsRes] = await Promise.all([
    // Plan IDs are already scoped to this athlete by the RLS-checked query
    // above. Reading moves through RLS re-runs the athlete/plan join per
    // move row and can hit the statement timeout.
    admin
      .from("plan_moves")
      .select("plan_id, target_kind, target_value, move_id")
      .in("plan_id", planIds),
    admin.from("coach_profiles").select("id, first_name, last_name").in("id", coachIds),
    admin
      .from("athlete_goals")
      .select("coach_id, sport")
      .eq("athlete_id", athlete.id)
      .in("coach_id", coachIds),
  ]);
  if (movesRes.error) dbError(movesRes.error);
  if (coachesRes.error) dbError(coachesRes.error);
  if (goalsRes.error) dbError(goalsRes.error);

  // Fallback: look up sport via moves.sport when a plan has no matching goal.
  const moveIds = Array.from(
    new Set((movesRes.data ?? []).map((m) => m.move_id).filter((v): v is string => !!v)),
  );
  let moveSport = new Map<string, string>();
  if (moveIds.length) {
    const mvRes = await admin.from("moves").select("id, sport").in("id", moveIds);
    if (mvRes.error) dbError(mvRes.error);
    moveSport = new Map((mvRes.data ?? []).map((m) => [m.id, m.sport]));
  }

  const agg = new Map<string, { count: number; minutes: number; firstMoveSport: string }>();
  for (const m of movesRes.data ?? []) {
    const cur = agg.get(m.plan_id) ?? { count: 0, minutes: 0, firstMoveSport: "" };
    cur.count += 1;
    if (m.target_kind === "mins") cur.minutes += Number(m.target_value);
    if (!cur.firstMoveSport && m.move_id) {
      cur.firstMoveSport = moveSport.get(m.move_id) ?? "";
    }
    agg.set(m.plan_id, cur);
  }

  const coachName = new Map<string, string>();
  for (const c of coachesRes.data ?? []) {
    coachName.set(c.id, `${c.first_name} ${c.last_name}`.trim());
  }

  const coachSport = new Map<string, string>();
  for (const g of goalsRes.data ?? []) {
    if (!g.coach_id) continue;
    if (!coachSport.has(g.coach_id)) coachSport.set(g.coach_id, g.sport);
  }

  // Same reasoning as moves above: plan IDs are already authorized.
  const sessionsByPlan = await loadSessionsByPlanIds(
    admin,
    plans.map((p) => p.id),
  );

  // A plan the athlete wrote has no coach, so its sport comes from the
  // athlete's own goals (when they train one sport, that one).
  const authoredSport = await (async () => {
    if (!plans.some((p) => p.source === "athlete")) return "";
    const g = await admin.from("athlete_goals").select("sport").eq("athlete_id", athlete.id);
    if (g.error) dbError(g.error);
    const sports = Array.from(new Set((g.data ?? []).map((r) => r.sport)));
    return sports.length === 1 ? sports[0] : "";
  })();

  const result: AthletePlanSummaryDTO[] = plans.map((p) => {
    const a = agg.get(p.id) ?? { count: 0, minutes: 0, firstMoveSport: "" };
    const sessions = sessionsByPlan.get(p.id) ?? {
      sessionsByState: emptySessionsByState(),
      sessionsTotal: 0,
    };
    const cid = p.coach_id ?? "";
    const authored = p.source === "athlete";
    const isGradus = !authored && (p.source === "gradus" || !cid);
    const sport = authored
      ? authoredSport || a.firstMoveSport
      : (cid && coachSport.get(cid)) || a.firstMoveSport || "";
    return {
      id: p.id,
      title: p.title || "Untitled plan",
      status: p.status as AthletePlanStatus,
      coachId: cid,
      coachName: authored ? athlete.first_name : (cid && coachName.get(cid)) || "Gradus",
      isGradus,
      sport,
      moveCount: a.count,
      totalMinutes: a.minutes,
      updatedAt: p.updated_at,
      sessionsByState: sessions.sessionsByState,
      sessionsTotal: sessions.sessionsTotal,
      ...(authored ? { source: "athlete" } : {}),
    };
  });

  const draftSummaries: AthleteDraftSummaryDTO[] = drafts.map((d) => {
    const a = agg.get(d.id) ?? { count: 0, minutes: 0, firstMoveSport: "" };
    return {
      id: d.id,
      title: d.title || "Untitled plan",
      status: "draft",
      source: "athlete",
      moveCount: a.count,
      totalMinutes: a.minutes,
      updatedAt: d.updated_at,
    };
  });

  return ctx.includeAuthored
    ? { athlete: me, plans: result, drafts: draftSummaries }
    : { athlete: me, plans: result };
}

/* ---------------- detail ---------------- */

export async function getAthletePlan(
  ctx: AthletePlansContext,
  id: string,
): Promise<AthletePlanDetailDTO> {
  const { supabase, admin } = ctx;
  const athlete = await findMyAthleteRow(supabase, ctx.userId);
  if (!athlete) throw notFound();

  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, title, notes, status, athlete_id, coach_id, updated_at, kind, source")
    .eq("id", id)
    .maybeSingle();
  if (error) dbError(error);
  if (!plan || plan.kind !== "plan" || plan.athlete_id !== athlete.id) throw notFound();
  // Drafts are excluded by the status check below; active/benched athlete-owned
  // plans (e.g. imported from a share link) are viewable on the web too.
  if (plan.status !== "active" && plan.status !== "benched") throw notFound();

  const [movesRes, coachRes] = await Promise.all([
    // Plan ownership was verified above; read moves with the admin client so
    // the per-row RLS join doesn't re-run for every move.
    admin
      .from("plan_moves")
      .select("id, position, name, description, cue, why, target_kind, target_value")
      .eq("plan_id", plan.id)
      .order("position", { ascending: true }),
    plan.coach_id
      ? admin
          .from("coach_profiles")
          .select("first_name, last_name")
          .eq("id", plan.coach_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as const),
  ]);
  if (movesRes.error) dbError(movesRes.error);
  if (coachRes.error) dbError(coachRes.error);

  const moves: AthletePlanMoveDTO[] = (movesRes.data ?? []).map((m) => ({
    id: m.id,
    position: m.position,
    name: m.name,
    description: m.description,
    cue: m.cue,
    why: m.why,
    targetKind: m.target_kind as TargetKind,
    targetValue: Number(m.target_value),
  }));

  const totalMinutes = moves
    .filter((m) => m.targetKind === "mins")
    .reduce((s, m) => s + m.targetValue, 0);

  const authored = plan.source === "athlete";
  const isGradus = !authored && (plan.source === "gradus" || !plan.coach_id);
  const coachFirst = authored
    ? athlete.first_name
    : (coachRes.data?.first_name ?? (isGradus ? "Gradus" : "Coach"));
  const coachLast = coachRes.data?.last_name ?? "";

  return {
    id: plan.id,
    title: plan.title || "Untitled plan",
    notes: plan.notes,
    status: plan.status as AthletePlanStatus,
    athleteId: plan.athlete_id,
    athleteFirstName: athlete.first_name,
    coachId: plan.coach_id ?? "",
    coachName: `${coachFirst} ${coachLast}`.trim(),
    coachFirstName: coachFirst,
    isGradus,
    moveCount: moves.length,
    totalMinutes,
    updatedAt: plan.updated_at,
    moves,
    ...(authored ? { source: "athlete" } : {}),
  };
}
