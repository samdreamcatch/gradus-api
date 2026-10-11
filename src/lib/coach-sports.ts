// Pre-seeded sport catalog. `key` values are stored in the database and must
// never change. `label` is display-only and can be edited freely.

export type SportKey =
  | "tennis"
  | "golf"
  | "figure_skating"
  | "dance"
  | "gymnastics"
  | "fencing"
  | "equestrian"
  | "swimming"
  | "track_field"
  | "wrestling"
  | "skiing"
  | "strength_conditioning";

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
  {
    key: "gymnastics",
    label: "Gymnastics",
    standard: "USA Gymnastics Development Program",
    levels: [
      { key: "level_1", label: "Level 1", suggestedHours: 2 },
      { key: "level_2", label: "Level 2", suggestedHours: 3 },
      { key: "level_3", label: "Level 3", suggestedHours: 4 },
      { key: "level_4", label: "Level 4", suggestedHours: 8 },
      { key: "level_5", label: "Level 5", suggestedHours: 12 },
      { key: "level_6", label: "Level 6", suggestedHours: 16 },
      { key: "level_7", label: "Level 7", suggestedHours: 20 },
      { key: "level_8", label: "Level 8", suggestedHours: 22 },
      { key: "level_9", label: "Level 9", suggestedHours: 24 },
      { key: "level_10", label: "Level 10", suggestedHours: 28 },
      { key: "elite", label: "Elite", suggestedHours: 32 },
    ],
  },
  {
    key: "fencing",
    label: "Fencing",
    standard: "USA Fencing Ratings",
    levels: [
      { key: "u", label: "U (Unrated)", suggestedHours: 2 },
      { key: "e", label: "E", suggestedHours: 4 },
      { key: "d", label: "D", suggestedHours: 8 },
      { key: "c", label: "C", suggestedHours: 12 },
      { key: "b", label: "B", suggestedHours: 16 },
      { key: "a", label: "A", suggestedHours: 20 },
    ],
  },
  {
    key: "equestrian",
    label: "Equestrian",
    standard: "",
    levels: [
      { key: "beginner", label: "Beginner", suggestedHours: 2 },
      { key: "advanced_beginner", label: "Advanced Beginner", suggestedHours: 4 },
      { key: "intermediate", label: "Intermediate", suggestedHours: 6 },
      { key: "advanced", label: "Advanced", suggestedHours: 10 },
      { key: "pre_professional", label: "Pre-Professional", suggestedHours: 16 },
    ],
  },
  {
    key: "swimming",
    label: "Swimming",
    standard: "USA Swimming Motivational Time Standards",
    levels: [
      { key: "b", label: "B", suggestedHours: 3 },
      { key: "bb", label: "BB", suggestedHours: 5 },
      { key: "a", label: "A", suggestedHours: 8 },
      { key: "aa", label: "AA", suggestedHours: 12 },
      { key: "aaa", label: "AAA", suggestedHours: 16 },
      { key: "aaaa", label: "AAAA", suggestedHours: 20 },
    ],
  },
  {
    key: "track_field",
    label: "Track & Field",
    standard: "",
    levels: [
      { key: "youth", label: "Youth", suggestedHours: 3 },
      { key: "high_school", label: "High School", suggestedHours: 6 },
      { key: "collegiate", label: "Collegiate", suggestedHours: 12 },
      { key: "elite", label: "Elite", suggestedHours: 18 },
      { key: "professional", label: "Professional", suggestedHours: 22 },
    ],
  },
  {
    key: "wrestling",
    label: "Wrestling",
    standard: "USA Wrestling",
    levels: [
      { key: "beginner", label: "Beginner", suggestedHours: 3 },
      { key: "folkstyle_club", label: "Folkstyle Club", suggestedHours: 6 },
      { key: "state_qualifier", label: "State Qualifier", suggestedHours: 12 },
      { key: "national_qualifier", label: "National Qualifier", suggestedHours: 18 },
      { key: "all_american", label: "All-American", suggestedHours: 22 },
    ],
  },
  {
    key: "skiing",
    label: "Skiing",
    standard: "",
    levels: [
      { key: "beginner", label: "Beginner", suggestedHours: 2 },
      { key: "advanced_beginner", label: "Advanced Beginner", suggestedHours: 4 },
      { key: "intermediate", label: "Intermediate", suggestedHours: 6 },
      { key: "advanced", label: "Advanced", suggestedHours: 10 },
      { key: "pre_professional", label: "Pre-Professional", suggestedHours: 16 },
    ],
  },
  {
    key: "strength_conditioning",
    label: "Strength & Conditioning",
    standard: "",
    levels: [
      {
        key: "general_fitness",
        label: "General fitness",
        hint: "Health, longevity, no sport goal",
        suggestedHours: 2,
      },
      {
        key: "in_season_maintenance",
        label: "Sport prep · in-season",
        hint: "Maintain during competition",
        suggestedHours: 3,
      },
      {
        key: "off_season_build",
        label: "Sport prep · off-season",
        hint: "Build strength between seasons",
        suggestedHours: 5,
      },
      {
        key: "performance_athlete",
        label: "Performance athlete",
        hint: "Competitive, structured programming",
        suggestedHours: 8,
      },
      {
        key: "elite_performance",
        label: "Elite performance",
        hint: "Collegiate / pro / national team",
        suggestedHours: 12,
      },
    ],
  },
];

export const SPORT_KEYS: SportKey[] = SPORTS.map((s) => s.key);

/** Fallback for custom sports / custom levels with no curated estimate. */
export const DEFAULT_SUGGESTED_HOURS = 3;

export function getSport(key: string): Sport | undefined {
  return SPORTS.find((s) => s.key === key);
}

/**
 * A sport key as people read it. Custom keys are `custom_<slug>_<suffix>`,
 * and the five-character suffix only keeps keys unique, so it never shows
 * (beta feedback 2026-10-07: "custom_new_sport_c715f" on the roster filter).
 */
export function sportDisplayLabel(key: string): string {
  const builtIn = getSport(key);
  if (builtIn) return builtIn.label;
  if (!key.startsWith("custom_")) return key;
  const slug = key.slice("custom_".length).replace(/_[a-z0-9]{5}$/, "");
  const label = slug
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return label || key;
}

/**
 * A built-in sport key, or a custom one as onboarding made them before
 * #206: `custom_` and the slug's lower-case letters, digits and underscores.
 */
export function isSportKey(key: string): boolean {
  return getSport(key) !== undefined || /^custom_[a-z0-9_]+$/.test(key);
}

export function getSportLevel(sportKey: string, levelKey: string): SportLevel | undefined {
  return getSport(sportKey)?.levels.find((l) => l.key === levelKey);
}

export function getSuggestedHours(sportKey: string, levelKey: string): number {
  return getSportLevel(sportKey, levelKey)?.suggestedHours ?? DEFAULT_SUGGESTED_HOURS;
}
