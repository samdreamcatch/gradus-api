/**
 * The athlete profile (PRD §6.7 item 6, milestone L3): a deterministic,
 * prompt-sized read over what Gradus already records about one athlete, so
 * the plan drafts, the coach's athlete summary and the pre-lesson briefing
 * can speak to pace and seasonal trends without any model training.
 *
 * Inputs: skill events (L1, `athlete_skill_events`), practice sessions
 * (`plan_sessions.state_index`, the canonical scale in `session-states.ts`),
 * level history (`athlete_goals_history`), and linked competition results.
 * Output, per athlete: the flow trend over 30 / 90 / 365 days and the months
 * where dips cluster; per sport: level changes, median days from first
 * attempt to first landing by move category, skills still in progress,
 * "likely" (inferred) landings kept apart, and competition scores over time.
 *
 * `computeAthleteProfile` and `formatProfileForPrompt` are pure; the loader
 * does the reads with the admin client after the caller's own roster check.
 * The profile's `hash` is stable for unchanged inputs so the prompt caches
 * that include it (the briefing) invalidate exactly when it changes. The text
 * carries no free text beyond competition names, which are sanitized; it
 * never names a move.
 */
import { createHash } from "crypto";
import { sanitizeUserContent } from "./ai-prompt-safety";
import { getSport, getSportLevel } from "./coach-sports";
import { STATE_LABELS } from "./session-states";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProfileDb = { from: (table: string) => any };

const DAY = 86_400_000;

export interface SkillEventInput {
  sport: string;
  kind: string;
  source: string;
  move_id: string | null;
  move_name: string;
  move_category: string;
  plan_id: string | null;
  occurred_at: string;
}

export interface ProfileInputs {
  now: Date;
  events: SkillEventInput[];
  /** `plans.created_at` by plan id: the start of a skill a coach answer closed with no earlier attempt on record. */
  planCreatedAt: Record<string, string>;
  sessions: { state_index: number; logged_at: string }[];
  levelHistory: {
    sport: string;
    created_at: string;
    previous_current_level_key: string | null;
    current_level_key: string;
  }[];
  results: {
    date: string | null;
    competition: string;
    event: string;
    segment: string;
    segmentScore: string;
  }[];
}

export interface FlowWindow {
  days: 30 | 90 | 365;
  sessions: number;
  /** Mean `state_index`, 0–4, rounded to one decimal. */
  mean: number | null;
  label: string | null;
}

export interface PaceRow {
  category: string;
  landed: number;
  medianDaysToLand: number;
}

export interface SportProfile {
  sport: string;
  sportLabel: string;
  levelChanges: { date: string; from: string; to: string }[];
  pace: PaceRow[];
  inProgress: number;
  likelyLanded: number;
  scores: ProfileInputs["results"];
}

export interface AthleteProfile {
  flow: FlowWindow[];
  /** Months ("March") where weeks well below this athlete's usual flow cluster; empty with too little history. */
  dipMonths: string[];
  sports: SportProfile[];
  hash: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function flowLabel(mean: number): string {
  return STATE_LABELS[Math.max(0, Math.min(STATE_LABELS.length - 1, Math.round(mean)))];
}

/** Monday-based week start, UTC, as YYYY-MM-DD: the bucket for dip detection. */
function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/** Enough history to call a dip a pattern: sessions and weeks below which the line is left out. */
export const DIP_MIN_SESSIONS = 20;
const DIP_MIN_WEEK_SESSIONS = 2;
/** A dip week's mean flow sits at least this far below the athlete's own year mean. */
const DIP_GAP = 0.75;

function dipMonths(sessions: ProfileInputs["sessions"]): string[] {
  if (sessions.length < DIP_MIN_SESSIONS) return [];
  const overall = sessions.reduce((s, x) => s + x.state_index, 0) / sessions.length;
  const byWeek = new Map<string, number[]>();
  for (const s of sessions) {
    const k = weekKey(s.logged_at);
    byWeek.set(k, [...(byWeek.get(k) ?? []), s.state_index]);
  }
  const counts = new Map<number, number>();
  for (const [week, states] of byWeek) {
    if (states.length < DIP_MIN_WEEK_SESSIONS) continue;
    const mean = states.reduce((a, b) => a + b, 0) / states.length;
    if (mean <= overall - DIP_GAP) {
      const month = new Date(`${week}T00:00:00Z`).getUTCMonth();
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 3)
    .map(([m]) => MONTHS[m]);
}

function skillKey(e: SkillEventInput): string {
  return e.move_id ?? `name:${e.move_name.trim().toLowerCase()}`;
}

function sportProfile(sport: string, inputs: ProfileInputs): SportProfile {
  const events = inputs.events.filter((e) => e.sport === sport);
  const certain = events.filter((e) => e.source !== "inferred");

  // First attempt and first landing per skill, from coach and protocol events.
  const skills = new Map<
    string,
    { category: string; start?: number; landed?: number; setAside?: boolean }
  >();
  for (const e of certain) {
    const key = skillKey(e);
    const at = Date.parse(e.occurred_at);
    const s = skills.get(key) ?? { category: e.move_category || "uncategorized" };
    if (e.kind === "attempted") s.start = Math.min(s.start ?? at, at);
    if (e.kind === "landed" || e.kind === "consistent") s.landed = Math.min(s.landed ?? at, at);
    if (e.kind === "parked" || e.kind === "dropped") s.setAside = true;
    // A coach answer closes a skill whose first attempt was never recorded:
    // the plan it lived in started it.
    if (e.source === "coach" && e.plan_id && inputs.planCreatedAt[e.plan_id]) {
      const planStart = Date.parse(inputs.planCreatedAt[e.plan_id]);
      s.start = Math.min(s.start ?? planStart, planStart);
    }
    skills.set(key, s);
  }
  const byCategory = new Map<string, number[]>();
  let inProgress = 0;
  for (const s of skills.values()) {
    // Landed at the very first sighting (a clean element in the first
    // competition that shows it): the start is unknown, so it says nothing
    // about pace and stays out of the medians.
    if (s.landed !== undefined && s.start !== undefined && s.landed === s.start) continue;
    if (s.landed !== undefined && s.start !== undefined && s.landed > s.start) {
      byCategory.set(s.category, [
        ...(byCategory.get(s.category) ?? []),
        Math.round((s.landed - s.start) / DAY),
      ]);
    } else if (s.landed === undefined && s.start !== undefined && !s.setAside) {
      // Parked or dropped skills are set aside, not in progress.
      inProgress += 1;
    }
  }
  const pace = [...byCategory.entries()]
    .map(([category, days]) => ({ category, landed: days.length, medianDaysToLand: median(days) }))
    .sort((a, b) => b.landed - a.landed || a.category.localeCompare(b.category));

  const likely = new Set(
    events
      .filter((e) => e.source === "inferred" && e.kind === "landed")
      .map(skillKey)
      .filter((k) => skills.get(k)?.landed === undefined),
  );

  const levelChanges = inputs.levelHistory
    .filter(
      (h) =>
        h.sport === sport &&
        h.previous_current_level_key !== null &&
        h.previous_current_level_key !== h.current_level_key,
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((h) => ({
      date: h.created_at.slice(0, 10),
      from:
        getSportLevel(sport, h.previous_current_level_key!)?.label ?? h.previous_current_level_key!,
      to: getSportLevel(sport, h.current_level_key)?.label ?? h.current_level_key,
    }));

  return {
    sport,
    sportLabel: getSport(sport)?.label ?? sport,
    levelChanges,
    pace,
    inProgress,
    likelyLanded: likely.size,
    scores: sport === "figure_skating" ? inputs.results : [],
  };
}

/** Pure: the profile for one athlete. `sports` limits the per-sport sections (the coach's sports). */
export function computeAthleteProfile(inputs: ProfileInputs, sports?: string[]): AthleteProfile {
  const now = inputs.now.getTime();
  const flow: FlowWindow[] = ([30, 90, 365] as const).map((days) => {
    const inWindow = inputs.sessions.filter((s) => now - Date.parse(s.logged_at) <= days * DAY);
    if (!inWindow.length) return { days, sessions: 0, mean: null, label: null };
    const mean = inWindow.reduce((s, x) => s + x.state_index, 0) / inWindow.length;
    return { days, sessions: inWindow.length, mean: round1(mean), label: flowLabel(mean) };
  });

  const known = new Set<string>([
    ...inputs.events.map((e) => e.sport),
    ...inputs.levelHistory.map((h) => h.sport),
    ...(inputs.results.length ? ["figure_skating"] : []),
  ]);
  known.delete("");
  const wanted = [...known].filter((s) => !sports || sports.includes(s)).sort();

  const profile = {
    flow,
    dipMonths: dipMonths(inputs.sessions.filter((s) => now - Date.parse(s.logged_at) <= 365 * DAY)),
    sports: wanted.map((s) => sportProfile(s, inputs)),
  };
  const hash = createHash("sha256").update(JSON.stringify(profile)).digest("hex").slice(0, 32);
  return { ...profile, hash };
}

/** Sanitized and on one line, so a stored name can never start a new prompt line. */
function oneLine(value: string, max: number): string {
  return sanitizeUserContent(value.replace(/\s+/g, " ").trim(), max);
}

function hasContent(p: AthleteProfile): boolean {
  return (
    p.flow.some((f) => f.sessions > 0) ||
    p.sports.some(
      (s) =>
        s.levelChanges.length || s.pace.length || s.inProgress || s.likelyLanded || s.scores.length,
    )
  );
}

/**
 * The profile as a prompt block, or "" when there is nothing to say (so a new
 * athlete's prompts are exactly what they were before L3).
 */
export function formatProfileForPrompt(p: AthleteProfile): string {
  if (!hasContent(p)) return "";
  const lines: string[] = [
    "ATHLETE PROFILE (derived from Gradus records only; mention a line only if it bears on what you are writing, and never go beyond what it says):",
  ];
  const flow = p.flow
    .filter((f) => f.sessions > 0)
    .map(
      (f) =>
        `last ${f.days} days ${f.sessions} session${f.sessions === 1 ? "" : "s"}, mostly ${f.label}`,
    );
  if (flow.length) lines.push(`- Practice flow: ${flow.join("; ")}.`);
  if (p.dipMonths.length) {
    lines.push(`- Flow dips have clustered in: ${p.dipMonths.join(", ")}.`);
  }
  for (const s of p.sports) {
    const out: string[] = [];
    if (s.levelChanges.length) {
      out.push(
        `- Level changes: ${s.levelChanges.map((c) => `${c.date} ${c.from} → ${c.to}`).join("; ")}.`,
      );
    }
    if (s.pace.length) {
      out.push(
        `- Time from first attempt to first landing: ${s.pace
          .map(
            (r) =>
              `${r.category} median ${r.medianDaysToLand} day${r.medianDaysToLand === 1 ? "" : "s"} (${r.landed} skill${r.landed === 1 ? "" : "s"})`,
          )
          .join("; ")}.`,
      );
    }
    if (s.inProgress) out.push(`- Skills attempted but not yet landed: ${s.inProgress}.`);
    if (s.likelyLanded) {
      out.push(`- Likely landed but not confirmed by the coach: ${s.likelyLanded}.`);
    }
    if (s.scores.length) {
      out.push(
        `- Competition scores, oldest first: ${s.scores
          .map(
            (r) =>
              `${r.date ?? "undated"} ${oneLine(r.competition, 80)} ${oneLine(r.event, 60)} ${oneLine(r.segment, 40)} ${oneLine(r.segmentScore, 12)}`,
          )
          .join("; ")}.`,
      );
    }
    if (out.length) lines.push(`${s.sportLabel}:`, ...out);
  }
  return lines.join("\n");
}

/* ---------------------------------------------------------------- loader */

/** Reads that fail (e.g., the L1 table before its migration is applied) count as no data. */
async function rows<T>(query: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  try {
    const { data, error } = await query;
    if (error) {
      console.warn("[athlete-profile] read skipped", error);
      return [];
    }
    return data ?? [];
  } catch (e) {
    console.warn("[athlete-profile] read skipped", e);
    return [];
  }
}

/**
 * Loads and computes the profile. The caller has already checked that the
 * signed-in coach may see this athlete. Never throws: a missing profile only
 * means the prompts read as they did before L3.
 */
export async function loadAthleteProfile(
  admin: ProfileDb,
  athleteId: string,
  opts: { now?: Date; sports?: string[] } = {},
): Promise<{ profile: AthleteProfile; text: string }> {
  const now = opts.now ?? new Date();
  const yearAgo = new Date(now.getTime() - 365 * DAY).toISOString();

  const [events, sessions, levelHistory, results] = await Promise.all([
    rows<SkillEventInput>(
      admin
        .from("athlete_skill_events")
        .select("sport, kind, source, move_id, move_name, move_category, plan_id, occurred_at")
        .eq("athlete_id", athleteId)
        .order("occurred_at", { ascending: true })
        .limit(2000),
    ),
    rows<{ state_index: number; logged_at: string }>(
      admin
        .from("plan_sessions")
        .select("state_index, logged_at")
        .eq("athlete_id", athleteId)
        .gte("logged_at", yearAgo)
        .order("logged_at", { ascending: true })
        .limit(1000),
    ),
    rows<ProfileInputs["levelHistory"][number]>(
      admin
        .from("athlete_goals_history")
        .select("sport, created_at, previous_current_level_key, current_level_key")
        .eq("athlete_id", athleteId)
        .order("created_at", { ascending: true })
        .limit(200),
    ),
    rows<{ competition_id: string; event_name: string; segment: string; segment_score: string }>(
      admin
        .from("athlete_competition_results")
        .select("competition_id, event_name, segment, segment_score")
        .eq("athlete_id", athleteId)
        .limit(200),
    ),
  ]);

  const planIds = [
    ...new Set(events.filter((e) => e.source === "coach" && e.plan_id).map((e) => e.plan_id!)),
  ];
  const plans = planIds.length
    ? await rows<{ id: string; created_at: string }>(
        admin.from("plans").select("id, created_at").in("id", planIds),
      )
    : [];

  const compIds = [...new Set(results.map((r) => r.competition_id))];
  const comps = compIds.length
    ? await rows<{ id: string; name: string; ends_on: string | null }>(
        admin.from("competitions").select("id, name, ends_on").in("id", compIds),
      )
    : [];
  const compById = new Map(comps.map((c) => [c.id, c]));
  const dated = results
    .map((r) => ({
      date: compById.get(r.competition_id)?.ends_on ?? null,
      competition: compById.get(r.competition_id)?.name ?? "competition",
      event: r.event_name,
      segment: r.segment,
      segmentScore: r.segment_score,
    }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .slice(-12);

  const profile = computeAthleteProfile(
    {
      now,
      events,
      planCreatedAt: Object.fromEntries(plans.map((p) => [p.id, p.created_at])),
      sessions,
      levelHistory,
      results: dated,
    },
    opts.sports,
  );
  return { profile, text: formatProfileForPrompt(profile) };
}

/**
 * The profile as one coach may see it: per-sport sections only for the
 * sports this coach coaches the athlete in (`coach_athlete_sports`), so a
 * tennis coach never reads the athlete's golf pace. Links from before sports
 * were recorded have no rows; those see every sport, as their summary does.
 */
export async function loadCoachAthleteProfile(
  admin: ProfileDb,
  coachId: string,
  athleteId: string,
  now: Date = new Date(),
): Promise<{ profile: AthleteProfile; text: string }> {
  const sports = await rows<{ sport: string }>(
    admin
      .from("coach_athlete_sports")
      .select("sport")
      .eq("coach_id", coachId)
      .eq("athlete_id", athleteId),
  );
  const list = [...new Set(sports.map((s) => s.sport))];
  return loadAthleteProfile(admin, athleteId, { now, sports: list.length ? list : undefined });
}

export type LoadCoachAthleteProfile = typeof loadCoachAthleteProfile;
