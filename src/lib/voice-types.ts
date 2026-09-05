export type FieldSource = { quote: string; start: number; end: number };

export interface VoiceSources {
  plan?: {
    title?: FieldSource;
    athleteId?: FieldSource;
    notes?: FieldSource;
  };
  moves?: Record<
    string,
    Partial<Record<"name" | "description" | "cue" | "why" | "target", FieldSource>>
  >;
}

export type VoicePlanDraft = {
  /**
   * True when the AI step failed (after a retry) and this draft is the
   * empty fallback. The transcript is still persisted on the plan so the
   * coach's words survive; the client shows an error instead of a success.
   */
  aiFailed?: boolean;
  title?: string | null;
  athleteId?: string | null;
  unresolvedAthleteName?: string | null;
  notes?: string | null;
  moves: {
    matchExistingMoveId?: string | null;
    libraryMoveId?: string | null;
    name: string;
    description: string;
    cue: string;
    why: string;
    targetKind: "reps" | "mins";
    targetValue: number;
    targetFromVoice?: boolean;
    sources?: Partial<Record<"name" | "description" | "cue" | "why" | "target", string>>;
  }[];
  sources?: {
    title?: string;
    athleteName?: string;
    notes?: string;
  };
};

export interface VoiceTouched {
  plan: { title?: boolean; athleteId?: boolean; notes?: boolean };
  moves: Record<string, string[]>;
  newMoveIds: string[];
  transcript?: string;
  sources?: VoiceSources;
}
