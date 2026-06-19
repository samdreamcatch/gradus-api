// Pre-seeded sport catalog. `key` values are stored in the database and must
// never change. `label` is display-only and can be edited freely.

export type SportKey = "tennis" | "golf" | "figure_skating" | "dance";

export interface SportLevel {
  key: string;
  label: string;
  hint?: string;
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
      { key: "ntrp_1_0", label: "NTRP 1.0", hint: "Just starting" },
      { key: "ntrp_1_5", label: "NTRP 1.5" },
      { key: "ntrp_2_0", label: "NTRP 2.0" },
      { key: "ntrp_2_5", label: "NTRP 2.5" },
      { key: "ntrp_3_0", label: "NTRP 3.0" },
      { key: "ntrp_3_5", label: "NTRP 3.5" },
      { key: "ntrp_4_0", label: "NTRP 4.0" },
      { key: "ntrp_4_5", label: "NTRP 4.5" },
      { key: "ntrp_5_0", label: "NTRP 5.0" },
      { key: "ntrp_5_5", label: "NTRP 5.5" },
      { key: "ntrp_6_0", label: "NTRP 6.0" },
      { key: "ntrp_7_0", label: "NTRP 7.0", hint: "World-class" },
    ],
  },
  {
    key: "golf",
    label: "Golf",
    standard: "USGA handicap brackets",
    levels: [
      { key: "beginner", label: "Beginner", hint: "No handicap yet" },
      { key: "high_handicap", label: "High handicap", hint: "19+" },
      { key: "mid_handicap", label: "Mid handicap", hint: "10–18" },
      { key: "low_handicap", label: "Low handicap", hint: "1–9" },
      { key: "scratch", label: "Scratch", hint: "0 or better" },
    ],
  },
  {
    key: "figure_skating",
    label: "Figure Skating",
    standard: "U.S. Figure Skating test track",
    levels: [
      { key: "basic_skills", label: "Basic Skills" },
      { key: "pre_preliminary", label: "Pre-Preliminary" },
      { key: "preliminary", label: "Preliminary" },
      { key: "pre_juvenile", label: "Pre-Juvenile" },
      { key: "juvenile", label: "Juvenile" },
      { key: "intermediate", label: "Intermediate" },
      { key: "novice", label: "Novice" },
      { key: "junior", label: "Junior" },
      { key: "senior", label: "Senior" },
    ],
  },
  {
    key: "dance",
    label: "Dance",
    standard: "",
    levels: [
      { key: "beginner", label: "Beginner" },
      { key: "advanced_beginner", label: "Advanced Beginner" },
      { key: "intermediate", label: "Intermediate" },
      { key: "advanced", label: "Advanced" },
      { key: "pre_professional", label: "Pre-Professional" },
    ],
  },
];

export const SPORT_KEYS: SportKey[] = SPORTS.map((s) => s.key);

export function getSport(key: string): Sport | undefined {
  return SPORTS.find((s) => s.key === key);
}

export function getSportLevel(sportKey: string, levelKey: string): SportLevel | undefined {
  return getSport(sportKey)?.levels.find((l) => l.key === levelKey);
}
