/**
 * Athlete skill events (PRD §6.7 "Athlete learning loop", milestone L1): the
 * signal the athlete profile (L3) learns pace from.
 *
 * Two writers live here:
 * - `recordCoachReasonEvents`: the coach's answer to the "why" prompt when a
 *   plan is benched or a move is removed (decision #17: skippable, so no
 *   answer writes nothing). Called from `setPlanStatus` and `removePlanMove`
 *   after their ownership checks.
 * - `replaceProtocolEvents`: every executed element of a linked competition
 *   protocol is `attempted`, a clean one also `landed`. Called from
 *   `linkAthleteToSkater`; `deleteProtocolEvents` undoes it on unlink.
 *
 * Service role only (migration 20260922180000: RLS on, no policies), so every
 * call takes the admin client. Writers never throw into the caller's action:
 * a lost event is a weaker profile, a failed bench is a broken app.
 *
 * `athlete_skill_events` is not in the generated Supabase types until Lovable
 * regenerates them, hence the loose client type (same as competitions.server).
 */
import { z } from "zod";
import type { SkaterProtocol } from "./board-types";
import { dbError } from "./db-error";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SkillEventsDb = { from: (table: string) => any };

export type SkillEventKind = "attempted" | "landed" | "consistent" | "parked" | "dropped";

/** The three answers to the coach "why" prompt (PRD §7.3, decision #17). */
export const skillReasonSchema = z.enum(["landed_it", "parking_it", "changed_direction"]);
export type SkillReason = z.infer<typeof skillReasonSchema>;

export const REASON_KIND: Record<SkillReason, SkillEventKind> = {
  landed_it: "landed",
  parking_it: "parked",
  changed_direction: "dropped",
};

export interface ReasonMove {
  planMoveId: string;
  moveId: string | null;
  name: string;
}

interface EventRow {
  athlete_id: string;
  coach_id: string | null;
  sport: string;
  kind: SkillEventKind;
  source: "coach" | "protocol" | "inferred";
  confidence: number;
  move_id: string | null;
  plan_move_id: string | null;
  plan_id: string | null;
  competition_id: string | null;
  move_name: string;
  move_category: string;
  element_code: string | null;
  element_ref: string | null;
  occurred_at: string;
  created_by_user_id: string | null;
}

/**
 * One coach-sourced event per move the answer covers: every move of a benched
 * plan, or the one removed move. A plan with no moves yields one plan-level
 * event so "why was this benched" is still on record. Returns the rows written.
 */
export async function recordCoachReasonEvents(
  admin: SkillEventsDb,
  input: {
    athleteId: string;
    coachId: string;
    userId: string;
    planId: string;
    reason: SkillReason;
    moves: ReasonMove[];
    now?: Date;
  },
): Promise<number> {
  const libraryIds = [
    ...new Set(input.moves.map((m) => m.moveId).filter((id): id is string => !!id)),
  ];
  const library = new Map<string, { sport: string; category: string }>();
  if (libraryIds.length) {
    const { data, error } = await admin
      .from("moves")
      .select("id, sport, category")
      .in("id", libraryIds);
    if (error) dbError(error);
    for (const m of (data ?? []) as { id: string; sport: string; category: string }[]) {
      library.set(m.id, { sport: m.sport ?? "", category: m.category ?? "" });
    }
  }
  const fallbackSport = await singleAthleteSport(admin, input.athleteId);

  const base = {
    athlete_id: input.athleteId,
    coach_id: input.coachId,
    kind: REASON_KIND[input.reason],
    source: "coach" as const,
    confidence: 1,
    plan_id: input.planId,
    competition_id: null,
    element_code: null,
    element_ref: null,
    occurred_at: (input.now ?? new Date()).toISOString(),
    created_by_user_id: input.userId,
  };
  const rows: EventRow[] = input.moves.length
    ? input.moves.map((m) => {
        const lib = m.moveId ? library.get(m.moveId) : undefined;
        return {
          ...base,
          sport: lib?.sport || fallbackSport,
          move_id: lib ? m.moveId : null,
          plan_move_id: m.planMoveId,
          move_name: m.name ?? "",
          move_category: lib?.category ?? "",
        };
      })
    : [
        {
          ...base,
          sport: fallbackSport,
          move_id: null,
          plan_move_id: null,
          move_name: "",
          move_category: "",
        },
      ];

  const { error } = await admin.from("athlete_skill_events").insert(rows);
  if (error) dbError(error);
  return rows.length;
}

/** The athlete's sport when they have exactly one goals row; otherwise unknown (""). */
async function singleAthleteSport(admin: SkillEventsDb, athleteId: string): Promise<string> {
  const { data, error } = await admin
    .from("athlete_goals")
    .select("sport")
    .eq("athlete_id", athleteId);
  if (error) dbError(error);
  const sports = [...new Set(((data ?? []) as { sport: string }[]).map((g) => g.sport))];
  return sports.length === 1 ? sports[0] : "";
}

/* -------------------------------------------------------------- protocol */

/** Marks the IJS appends to an executed element code. */
const MARK_PATTERN = /<<|<|\*|!|q$|x$/g;

/**
 * The executed code without its judging marks, so "3T<" and "3T" are the same
 * skill: under-rotation (<, <<), invalid (*), attention (!), quarter (q),
 * bonus-half (x), and the edge call "e" after Lz/F.
 */
export function normalizeElementCode(executed: string): string {
  return executed
    .trim()
    .split("+")
    .map((part) => part.replace(MARK_PATTERN, "").replace(/^(\d?(?:Lz|F))e$/, "$1"))
    .join("+");
}

/** The element's family, the category L3 groups pace by. */
export function elementCategory(code: string): string {
  const c = normalizeElementCode(code);
  if (/^\d(A|T|S|Lo|F|Lz|Eu)(\+|$)/.test(c)) return "jump";
  if (/Sp[\dB]?V?$/.test(c)) return "spin";
  if (/^StSq/.test(c)) return "step";
  if (/^ChSq/.test(c)) return "choreo";
  return "other";
}

/** Clean per PRD §6.7 item 4: GOE >= 0 and no under-rotation or invalid mark. */
export function isCleanElement(el: { executed: string; goe: string }): boolean {
  const goe = Number.parseFloat(el.goe);
  if (!Number.isFinite(goe) || goe < 0) return false;
  return !/[<*]/.test(el.executed);
}

export interface ProtocolResult {
  eventName: string;
  segment: string;
  protocol: SkaterProtocol | null;
}

/** Pure: the event rows a set of linked results produces. */
export function protocolEventRows(input: {
  athleteId: string;
  coachId: string | null;
  userId: string | null;
  competitionId: string;
  occurredAt: string;
  results: ProtocolResult[];
}): EventRow[] {
  const rows: EventRow[] = [];
  for (const r of input.results) {
    const elements = r.protocol?.elements ?? [];
    elements.forEach((el, index) => {
      const executed = (el.executed || el.planned || "").trim();
      if (!executed) return;
      const code = normalizeElementCode(executed);
      const common = {
        athlete_id: input.athleteId,
        coach_id: input.coachId,
        sport: "figure_skating",
        source: "protocol" as const,
        confidence: 1,
        move_id: null,
        plan_move_id: null,
        plan_id: null,
        competition_id: input.competitionId,
        move_name: code,
        move_category: elementCategory(code),
        element_code: executed,
        element_ref: `${r.eventName}|${r.segment}|${index}`,
        occurred_at: input.occurredAt,
        created_by_user_id: input.userId,
      };
      rows.push({ ...common, kind: "attempted" });
      if (isCleanElement({ executed, goe: el.goe })) rows.push({ ...common, kind: "landed" });
    });
  }
  return rows;
}

/** Replace the competition's protocol events for the athlete (re-linking never doubles them). */
export async function replaceProtocolEvents(
  admin: SkillEventsDb,
  input: Parameters<typeof protocolEventRows>[0],
): Promise<number> {
  await deleteProtocolEvents(admin, input.athleteId, input.competitionId);
  const rows = protocolEventRows(input);
  if (!rows.length) return 0;
  const { error } = await admin.from("athlete_skill_events").insert(rows);
  if (error) dbError(error);
  return rows.length;
}

export async function deleteProtocolEvents(
  admin: SkillEventsDb,
  athleteId: string,
  competitionId: string,
): Promise<void> {
  const { error } = await admin
    .from("athlete_skill_events")
    .delete()
    .eq("athlete_id", athleteId)
    .eq("competition_id", competitionId)
    .eq("source", "protocol");
  if (error) dbError(error);
}
