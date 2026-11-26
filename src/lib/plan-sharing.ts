/**
 * One plan for several athletes (PRD decision #66): the pure rules.
 *
 * A plan's "content" is what an athlete's copy receives: title, notes, the
 * feedback choice, and the moves in order. Two plans match when their content
 * is equal; ids, status, and timestamps never count. From that one comparison:
 *
 *  - a copy has custom edits when it no longer equals what it last received;
 *  - a copy is behind when the coach's plan no longer equals what it received;
 *  - "what changed" is the difference between two contents, move by move.
 *
 * No database or network here, so the rules are tested on their own.
 */

export type ShareTargetKind = "reps" | "mins";

export interface PlanContentMove {
  /** The library move this row came from, when it has one. Copies keep it. */
  moveId: string | null;
  name: string;
  description: string;
  cue: string;
  why: string;
  targetKind: ShareTargetKind;
  targetValue: number;
}

export interface PlanContent {
  title: string;
  notes: string;
  feedbackScope: "plan" | "moves";
  moves: PlanContentMove[];
}

/** A move as the database stores it (only the columns content needs). */
export interface StoredMove {
  id?: string;
  move_id: string | null;
  name: string;
  description: string | null;
  cue: string | null;
  why: string | null;
  target_kind: string;
  target_value: number | string;
}

export function contentMove(m: StoredMove): PlanContentMove {
  return {
    moveId: m.move_id ?? null,
    name: m.name,
    description: m.description ?? "",
    cue: m.cue ?? "",
    why: m.why ?? "",
    targetKind: m.target_kind === "mins" ? "mins" : "reps",
    targetValue: Number(m.target_value),
  };
}

export function planContent(
  plan: { title: string | null; notes: string | null; feedback_scope?: string | null },
  moves: StoredMove[],
): PlanContent {
  return {
    title: plan.title ?? "",
    notes: plan.notes ?? "",
    feedbackScope: plan.feedback_scope === "moves" ? "moves" : "plan",
    moves: moves.map(contentMove),
  };
}

/**
 * Reads a stored snapshot back. Anything that is not a snapshot (null, an
 * older shape) answers null, which every caller treats as "nothing received
 * yet": the copy shows no custom edits and is offered the next update.
 */
export function parseContent(value: unknown): PlanContent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== "string" || typeof v.notes !== "string" || !Array.isArray(v.moves)) {
    return null;
  }
  const moves: PlanContentMove[] = [];
  for (const raw of v.moves) {
    if (!raw || typeof raw !== "object") return null;
    const m = raw as Record<string, unknown>;
    if (typeof m.name !== "string") return null;
    moves.push({
      moveId: typeof m.moveId === "string" ? m.moveId : null,
      name: m.name,
      description: typeof m.description === "string" ? m.description : "",
      cue: typeof m.cue === "string" ? m.cue : "",
      why: typeof m.why === "string" ? m.why : "",
      targetKind: m.targetKind === "mins" ? "mins" : "reps",
      targetValue: Number(m.targetValue ?? 0),
    });
  }
  return {
    title: v.title,
    notes: v.notes,
    feedbackScope: v.feedbackScope === "moves" ? "moves" : "plan",
    moves,
  };
}

const sameMove = (a: PlanContentMove, b: PlanContentMove) =>
  a.moveId === b.moveId &&
  a.name === b.name &&
  a.description === b.description &&
  a.cue === b.cue &&
  a.why === b.why &&
  a.targetKind === b.targetKind &&
  a.targetValue === b.targetValue;

/** Field by field, so key order in stored JSON never matters. */
export function sameContent(a: PlanContent | null, b: PlanContent | null): boolean {
  if (!a || !b) return false;
  return (
    a.title === b.title &&
    a.notes === b.notes &&
    a.feedbackScope === b.feedbackScope &&
    a.moves.length === b.moves.length &&
    a.moves.every((m, i) => sameMove(m, b.moves[i]))
  );
}

/** What an update did to one move, as the apps tag it. */
export type MoveChange = "new" | "minutes" | "reps" | "changed";

/**
 * How one move is recognised as "the same move" on both sides: its library
 * link when it has one, otherwise its name. A renamed move with no library
 * link therefore reads as one removed and one new, which is also how a coach
 * would describe it.
 */
const matchKey = (m: PlanContentMove) =>
  m.moveId ? `id:${m.moveId}` : `name:${m.name.trim().toLowerCase()}`;

export interface MoveMatch {
  /** For each move in `to`: the index of its match in `from`, or null when it is new. */
  fromIndex: Array<number | null>;
  /** Indexes in `from` that nothing in `to` matched: removed moves. */
  removed: number[];
}

/** Pairs moves in order, so a plan with the same move twice pairs first with first. */
export function matchMoves(from: PlanContentMove[], to: PlanContentMove[]): MoveMatch {
  const waiting = new Map<string, number[]>();
  from.forEach((m, i) => {
    const key = matchKey(m);
    const list = waiting.get(key);
    if (list) list.push(i);
    else waiting.set(key, [i]);
  });
  const fromIndex = to.map((m) => waiting.get(matchKey(m))?.shift() ?? null);
  const used = new Set(fromIndex.filter((i): i is number => i !== null));
  return { fromIndex, removed: from.map((_, i) => i).filter((i) => !used.has(i)) };
}

/** The tag for a move that exists on both sides, or null when nothing about it changed. */
export function moveChange(before: PlanContentMove, after: PlanContentMove): MoveChange | null {
  if (before.targetKind !== after.targetKind || before.targetValue !== after.targetValue) {
    return after.targetKind === "mins" ? "minutes" : "reps";
  }
  if (
    before.name !== after.name ||
    before.description !== after.description ||
    before.cue !== after.cue ||
    before.why !== after.why
  ) {
    return "changed";
  }
  return null;
}

/** One line of "what changed": a move (by its place in `to`), or something about the plan. */
export interface ContentChange {
  /** Index into `to.moves`; null for a removed move or a plan-level change. */
  index: number | null;
  /** The move's name; empty for a plan-level change. */
  name: string;
  change: MoveChange | "removed" | "title" | "notes" | "feedback" | "order";
}

/**
 * Everything that differs going from `from` to `to`: changed and new moves in
 * the plan's order, then removed moves, then the plan's own fields. Empty when
 * the two match. A pure reorder is one "order" line.
 */
export function diffContent(from: PlanContent, to: PlanContent): ContentChange[] {
  const changes: ContentChange[] = [];
  const match = matchMoves(from.moves, to.moves);
  to.moves.forEach((move, i) => {
    const j = match.fromIndex[i];
    const change = j === null ? "new" : moveChange(from.moves[j], move);
    if (change) changes.push({ index: i, name: move.name, change });
  });
  for (const j of match.removed) {
    changes.push({ index: null, name: from.moves[j].name, change: "removed" });
  }
  if (from.title !== to.title) changes.push({ index: null, name: "", change: "title" });
  if (from.notes !== to.notes) changes.push({ index: null, name: "", change: "notes" });
  if (from.feedbackScope !== to.feedbackScope) {
    changes.push({ index: null, name: "", change: "feedback" });
  }
  // The same moves in a different order: matched pairs no longer rise together.
  const kept = match.fromIndex.filter((i): i is number => i !== null);
  if (kept.some((v, i) => i > 0 && v < kept[i - 1])) {
    changes.push({ index: null, name: "", change: "order" });
  }
  return changes;
}
