/**
 * Client-side rules for AI move drafts (PRD decision #53): a draft fills only
 * the fields the coach left empty, never what they typed; an unrecognised
 * move fills nothing and asks for a hint. Shared by the library move sheet
 * and the plan editor's new-move form.
 */

export type DraftableMoveField = "description" | "cue" | "why" | "category";

export interface MoveDraftFields {
  description: string;
  cue: string;
  why: string;
  category?: string;
  /** Where the text came from; never shown, only used to skip the AI mark. */
  source?: "gradus_library" | "exercise_list" | "ai";
  /** Missing means "known" (a server from before the recognition check). */
  recognition?: "known" | "unsure" | "unknown";
}

export const AI_DRAFTED_NOTE = "Drafted by AI — check it before saving";

/** The longest hint the server takes. */
export const DRAFT_HINT_MAX = 200;

/** "unsure" and "unknown" fill nothing; the coach adds a hint and drafts again. */
export function isUnrecognised(draft: Pick<MoveDraftFields, "recognition">): boolean {
  return draft.recognition === "unsure" || draft.recognition === "unknown";
}

export function unrecognisedMessage(name: string, sportLabel: string): string {
  return `Gradus doesn't recognise “${name.trim()}” in ${sportLabel}. Add a few words about it and draft again.`;
}

/** What the coach sees when a draft lands for a name or sport they have since changed. */
export const DRAFT_STALE_NOTE = "The move changed while drafting, so nothing was filled.";

/** The name and sport a draft was asked for. */
export interface DraftTarget {
  name: string;
  sport: string;
}

/**
 * Whether a draft still belongs to the move: one that lands after the coach
 * renamed the move or changed its sport fills nothing and saves nothing.
 */
export function sameDraftTarget(
  asked: DraftTarget,
  now: { name?: string | null; sport?: string | null },
): boolean {
  return (
    asked.name.trim() === (now.name ?? "").trim() && asked.sport.trim() === (now.sport ?? "").trim()
  );
}

/** Library text is Gradus's own, so only AI-written fields carry the "Drafted by AI" mark. */
export function marksAsAi(draft: Pick<MoveDraftFields, "source">): boolean {
  return draft.source !== "gradus_library";
}

/**
 * The drafted values that may fill the form. `placeholderCategories` lists
 * category values that count as empty (the library sheet saves a nameless
 * category as "Uncategorized").
 */
export function draftFills(
  current: Partial<Record<DraftableMoveField, string | null | undefined>>,
  draft: MoveDraftFields,
  placeholderCategories: string[] = [],
): Partial<Record<DraftableMoveField, string>> {
  const fills: Partial<Record<DraftableMoveField, string>> = {};
  for (const key of ["description", "cue", "why"] as const) {
    const value = draft[key]?.trim();
    if (value && !(current[key] ?? "").trim()) fills[key] = value;
  }
  const category = (current.category ?? "").trim();
  const suggested = draft.category?.trim();
  if (suggested && (!category || placeholderCategories.includes(category))) {
    fills.category = suggested;
  }
  return fills;
}
