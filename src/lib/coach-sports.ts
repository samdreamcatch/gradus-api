// Pre-seeded sport catalog. `key` values are stored in the database and must
// never change. `label` is display-only and can be edited freely.

export type SportKey = "tennis" | "golf" | "figure_skating" | "dance";

export interface SportLevel {
  key: string;
  label: string;
  hint?: string;
  /**
   * Rough estimate of weekly solo-practice hours typical for an athlete at
   * this level (outside of formal lessons). Used to pre-populate the
   * onboarding hours step. Sources: USTA player development guidelines,
   * USGA/PGA practice norms, U.S. Figure Skating test-track training loads,
   * and standard pre-professional dance training schedules.
   */
  suggestedHours: number;
}

export interface Sport {
  key: SportKey;
  label: string;
  standard: string;
  levels: SportLevel[];
}

export const SPORTS: Sport[] = [
  {
    key: "tennis",
    label: "Tennis",
    standard: "USTA NTRP",
    levels: [
      { key: "ntrp_1_0", label: "NTRP 1.0", hint: "Just starting", suggestedHours: 1 },
      { key: "ntrp_1_5", label: "NTRP 1.5", suggestedHours: 1 },
      { key: "ntrp_2_0", label: "NTRP 2.0", suggestedHours: 1.5 },
      { key: "ntrp_2_5", label: "NTRP 2.5", suggestedHours: 2 },
      { key: "ntrp_3_0", label: "NTRP 3.0", suggestedHours: 3 },
      { key: "ntrp_3_5", label: "NTRP 3.5", suggestedHours: 4 },
      { key: "ntrp_4_0", label: "NTRP 4.0", suggestedHours: 5 },
      { key: "ntrp_4_5", label: "NTRP 4.5", suggestedHours: 7 },
      { key: "ntrp_5_0", label: "NTRP 5.0", suggestedHours: 10 },
      { key: "ntrp_5_5", label: "NTRP 5.5", suggestedHours: 12 },
      { key: "ntrp_6_0", label: "NTRP 6.0", suggestedHours: 15 },
      { key: "ntrp_7_0", label: "NTRP 7.0", hint: "World-class", suggestedHours: 20 },
    ],
  },
  {
    key: "golf",
    label: "Golf",
    standard: "USGA handicap brackets",
    levels: [
      { key: "beginner", label: "Beginner", hint: "No handicap yet", suggestedHours: 1 },
      { key: "high_handicap", label: "High handicap", hint: "19+", suggestedHours: 2 },
      { key: "mid_handicap", label: "Mid handicap", hint: "10–18", suggestedHours: 4 },
      { key: "low_handicap", label: "Low handicap", hint: "1–9", suggestedHours: 6 },
      { key: "scratch", label: "Scratch", hint: "0 or better", suggestedHours: 10 },
    ],
  },
  {
    key: "figure_skating",
    label: "Figure Skating",
    standard: "U.S. Figure Skating test track",
    levels: [
      { key: "basic_skills", label: "Basic Skills", suggestedHours: 2 },
      { key: "pre_preliminary", label: "Pre-Preliminary", suggestedHours: 3 },
      { key: "preliminary", label: "Preliminary", suggestedHours: 4 },
      { key: "pre_juvenile", label: "Pre-Juvenile", suggestedHours: 6 },
      { key: "juvenile", label: "Juvenile", suggestedHours: 8 },
      { key: "intermediate", label: "Intermediate", suggestedHours: 10 },
      { key: "novice", label: "Novice", suggestedHours: 14 },
      { key: "junior", label: "Junior", suggestedHours: 18 },
      { key: "senior", label: "Senior", suggestedHours: 22 },
    ],
  },
  {
    key: "dance",
    label: "Dance",
    standard: "",
    levels: [
      { key: "beginner", label: "Beginner", suggestedHours: 2 },
      { key: "advanced_beginner", label: "Advanced Beginner", suggestedHours: 4 },
      { key: "intermediate", label: "Intermediate", suggestedHours: 6 },
      { key: "advanced", label: "Advanced", suggestedHours: 10 },
      { key: "pre_professional", label: "Pre-Professional", suggestedHours: 16 },
    ],
  },
];

export const SPORT_KEYS: SportKey[] = SPORTS.map((s) => s.key);

/** Fallback for custom sports / custom levels with no curated estimate. */
export const DEFAULT_SUGGESTED_HOURS = 3;

export function getSport(key: string): Sport | undefined {
  return SPORTS.find((s) => s.key === key);
}

export function getSportLevel(sportKey: string, levelKey: string): SportLevel | undefined {
  return getSport(sportKey)?.levels.find((l) => l.key === levelKey);
}

export function getSuggestedHours(sportKey: string, levelKey: string): number {
  return getSportLevel(sportKey, levelKey)?.suggestedHours ?? DEFAULT_SUGGESTED_HOURS;
}
