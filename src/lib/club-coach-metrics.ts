export type CoachWeek = {
  coach_id: string;
  week_start: string;
  students: number | null;
  minors: number | null;
  practice_min: number;
  target_min: number | null;
  sessions: number;
  students_meeting_target?: number | null;
  lessons?: number | null;
  computed_at: string;
};

export function weekStart(value = new Date()): string {
  const day = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

export function targetPercent(practice: number, target: number | null): number | null {
  return target === null || target <= 0 ? null : Math.round(practice / target * 100);
}

export function practiceAdherence(meeting: number | null | undefined, students: number | null): number | null {
  if (meeting == null || students == null || students <= 0) return null;
  return Math.round(meeting / students * 100);
}

export function sumCoachWeeks(rows: CoachWeek[]) {
  return {
    students: rows.every((r) => r.students !== null) ? rows.reduce((n, r) => n + (r.students ?? 0), 0) : null,
    practice: rows.reduce((n, r) => n + Number(r.practice_min), 0),
    target: rows.every((r) => r.target_min !== null) ? rows.reduce((n, r) => n + Number(r.target_min), 0) : null,
    sessions: rows.reduce((n, r) => n + r.sessions, 0),
  };
}