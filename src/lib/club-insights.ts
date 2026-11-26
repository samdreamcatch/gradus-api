import { practiceAdherence, targetPercent, type CoachWeek } from "./club-coach-metrics";

/** Current mobile practice ratings, ordered by the stored state_index. */
export const PRACTICE_DIFFICULTY_LABELS = ["Easy", "A bit easy", "Just right", "A bit hard", "Hard"] as const;

/** Governed Insights questions. AI may only choose among these; it never writes queries. */
export const INSIGHT_QUESTIONS = [
  {
    id: "practice_vs_target",
    title: "Practice vs. target last week",
    prompt: "How many practice minutes did each coach's students log last week, compared with their targets?",
  },
  {
    id: "session_feel",
    title: "Practice difficulty",
    prompt: "For each coach, how difficult did students rate practice over the last 4 weeks?",
  },
  {
    id: "stuck_students",
    title: "Practising but not progressing",
    prompt: "Which students practise a lot but haven't landed or consolidated a skill in 8 weeks?",
  },
  {
    id: "coach_comparison",
    title: "Coaches side by side",
    prompt: "Compare coaches on students, lessons, practice, adherence, plans and skills progressed over the last 4 weeks.",
  },
] as const;

export type InsightId = (typeof INSIGHT_QUESTIONS)[number]["id"];
export const INSIGHT_IDS = INSIGHT_QUESTIONS.map((q) => q.id) as [InsightId, ...InsightId[]];

export type InsightColumn = { key: string; label: string; kind?: "number" | "percent" | "text" };
export type InsightCell = string | number | null;
export type InsightResult = {
  id: InsightId;
  title: string;
  note: string;
  columns: InsightColumn[];
  rows: Record<string, InsightCell>[];
};

export type InsightInput = {
  coaches: { id: string; name: string }[];
  weeks: CoachWeek[];
  links: { coach_id: string; athlete_id: string }[];
  students: { id: string; name: string }[];
  plans: { id: string; coach_id: string | null; athlete_id: string | null; status: string }[];
  sessions: { plan_id: string; athlete_id: string; duration_seconds: number; state_index: number; logged_at: string }[];
  skills: { athlete_id: string; coach_id: string | null; kind: string; occurred_at: string }[];
};

/** Skill events that count as progress: a move landed or made consistent. */
export const PROGRESS_KINDS = new Set(["landed", "consistent"]);
export const STUCK_MIN_PRACTICE = 120;

const mins = (s: number) => Math.round(s / 60);

export function practiceVsTarget(input: InsightInput, week: string): InsightResult {
  const rows = input.coaches.map((c) => {
    const w = input.weeks.find((r) => r.coach_id === c.id && r.week_start === week);
    const practice = w ? Number(w.practice_min) : 0;
    const target = w?.target_min == null ? null : Number(w.target_min);
    return {
      coach: c.name,
      students: w?.students ?? null,
      practice,
      target,
      of_target: targetPercent(practice, target),
      adherence: practiceAdherence(w?.students_meeting_target, w?.students ?? null),
    };
  });
  return {
    id: "practice_vs_target",
    title: "Practice vs. target last week",
    note: `Week of ${week}. Adherence is the share of a coach's students who met their own target.`,
    columns: [
      { key: "coach", label: "Coach" },
      { key: "students", label: "Students", kind: "number" },
      { key: "practice", label: "Practice min", kind: "number" },
      { key: "target", label: "Target min", kind: "number" },
      { key: "of_target", label: "% of target", kind: "percent" },
      { key: "adherence", label: "Adherence", kind: "percent" },
    ],
    rows: rows.sort((a, b) => (b.of_target ?? -1) - (a.of_target ?? -1)),
  };
}

export function sessionFeel(input: InsightInput, since: string): InsightResult {
  const planCoach = new Map(input.plans.map((p) => [p.id, p.coach_id]));
  const rows = input.coaches.map((c) => {
    const s = input.sessions.filter((x) => x.logged_at >= since && planCoach.get(x.plan_id) === c.id);
    const row: Record<string, InsightCell> = { coach: c.name, sessions: s.length };
    PRACTICE_DIFFICULTY_LABELS.forEach((_, i) => {
      row[`s${i}`] = s.length ? Math.round((s.filter((x) => x.state_index === i).length / s.length) * 100) : null;
    });
    return row;
  });
  return {
    id: "session_feel",
    title: "Practice difficulty",
    note: "Share of logged sessions by the student's practice difficulty rating. Difficulty does not measure effort or skill.",
    columns: [
      { key: "coach", label: "Coach" },
      { key: "sessions", label: "Sessions", kind: "number" },
      ...PRACTICE_DIFFICULTY_LABELS.map((label, i) => ({ key: `s${i}`, label, kind: "percent" as const })),
    ],
    rows,
  };
}

export function stuckStudents(input: InsightInput, since: string, minPractice = STUCK_MIN_PRACTICE): InsightResult {
  const coachName = new Map(input.coaches.map((c) => [c.id, c.name]));
  const rows = input.students.flatMap((st) => {
    const s = input.sessions.filter((x) => x.athlete_id === st.id && x.logged_at >= since);
    const practice = mins(s.reduce((n, x) => n + x.duration_seconds, 0));
    const progress = input.skills.filter(
      (k) => k.athlete_id === st.id && k.occurred_at >= since && PROGRESS_KINDS.has(k.kind),
    ).length;
    if (practice < minPractice || progress > 0) return [];
    const coaches = [...new Set(input.links.filter((l) => l.athlete_id === st.id).map((l) => coachName.get(l.coach_id)).filter(Boolean))];
    const last = s.map((x) => x.logged_at).sort().at(-1) ?? null;
    return [{ student: st.name, coach: coaches.join(", "), practice, sessions: s.length, last: last?.slice(0, 10) ?? null }];
  });
  return {
    id: "stuck_students",
    title: "Practising but not progressing",
    note: `Students with at least ${minPractice} practice minutes since ${since} and no move landed or made consistent in that time.`,
    columns: [
      { key: "student", label: "Student" },
      { key: "coach", label: "Coach" },
      { key: "practice", label: "Practice min", kind: "number" },
      { key: "sessions", label: "Sessions", kind: "number" },
      { key: "last", label: "Last practice", kind: "text" },
    ],
    rows: rows.sort((a, b) => b.practice - a.practice),
  };
}

export function coachComparison(input: InsightInput, weeks: string[], since: string): InsightResult {
  const rows = input.coaches.map((c) => {
    const w = input.weeks.filter((r) => r.coach_id === c.id && weeks.includes(r.week_start));
    const n = weeks.length || 1;
    const athletes = new Set(input.links.filter((l) => l.coach_id === c.id).map((l) => l.athlete_id));
    const adh = w.map((r) => practiceAdherence(r.students_meeting_target, r.students)).filter((v): v is number => v !== null);
    return {
      coach: c.name,
      students: athletes.size,
      lessons: Math.round((w.reduce((s, r) => s + (r.lessons ?? 0), 0) / n) * 10) / 10,
      practice: Math.round(w.reduce((s, r) => s + Number(r.practice_min), 0) / n),
      adherence: adh.length ? Math.round(adh.reduce((a, b) => a + b, 0) / adh.length) : null,
      plans: input.plans.filter((p) => p.coach_id === c.id && p.status === "active").length,
      progressed: input.skills.filter(
        (k) => k.occurred_at >= since && PROGRESS_KINDS.has(k.kind) &&
          (k.coach_id === c.id || (k.coach_id === null && athletes.has(k.athlete_id))),
      ).length,
    };
  });
  return {
    id: "coach_comparison",
    title: "Coaches side by side",
    note: `Averages per week over the last ${weeks.length} full weeks. Skills progressed counts moves landed or made consistent.`,
    columns: [
      { key: "coach", label: "Coach" },
      { key: "students", label: "Students", kind: "number" },
      { key: "lessons", label: "Lessons/wk", kind: "number" },
      { key: "practice", label: "Practice min/wk", kind: "number" },
      { key: "adherence", label: "Avg adherence", kind: "percent" },
      { key: "plans", label: "Active plans", kind: "number" },
      { key: "progressed", label: "Skills progressed", kind: "number" },
    ],
    rows,
  };
}
