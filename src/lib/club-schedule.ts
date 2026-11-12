import { parseScheduleCsv, splitCsv, validateRows, type ImportRow } from "./schedule-import";
import { toCsv } from "./csv";
import { IMPORT_DAYS, minutesToHHMM } from "./schedule-import";

export type ClubScheduleRow = ImportRow & {
  coachName: string;
  coachId: string | null;
  age: number | null;
  athleteId?: string | null;
  startsOn?: string | null;
  weeksOfMonth?: number[];
};

export type ClubScheduleStudent = {
  id: string;
  firstName: string;
  lastName: string;
  coachIds: string[];
};

// Leave unresolved students with their coach's existing onboarding flow, never impersonate a coach.
export function partitionClubSchedule(rows: ClubScheduleRow[]) {
  const errors = clubScheduleCommitErrors(rows);
  return {
    ready: rows.filter(r => !errors[r.id]?.length),
    waiting: rows.filter(r => !!errors[r.id]?.length),
  };
}

export function clubCoachHandoffs(rows: ClubScheduleRow[]) {
  const groups = new Map<string, ClubScheduleRow[]>();
  for (const row of rows) {
    if (!row.coachId || row.athleteId) continue;
    groups.set(row.coachId, [...(groups.get(row.coachId) ?? []), row]);
  }
  return [...groups].map(([coachId, lessons]) => ({
    coachId,
    coachName: lessons[0]?.coachName ?? "Coach",
    lessons: lessons.length,
    csv: toCsv(
      ["athlete_first_name", "athlete_last_name", "age", "day", "start_time", "length_minutes", "frequency", "guardian_email", "athlete_email", "sport"],
      lessons.map(r => [r.firstName, r.lastName, r.age, IMPORT_DAYS.find(d => d.value === r.dayOfWeek)?.long, r.startMinute === null ? null : minutesToHHMM(r.startMinute), r.lengthMinutes, r.frequency, r.guardianEmail, r.athleteEmail, r.sport]),
    ),
  }));
}

// Only match the selected coach's existing roster; duplicate names need a human decision.
export function matchClubScheduleStudent(row: ClubScheduleRow, students: ClubScheduleStudent[]) {
  const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const matches = students.filter(
    (s) =>
      row.coachId &&
      s.coachIds.includes(row.coachId) &&
      normalize(s.firstName) === normalize(row.firstName) &&
      normalize(s.lastName) === normalize(row.lastName),
  );
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}

export function clubScheduleCommitErrors(rows: ClubScheduleRow[]) {
  const errors = clubScheduleErrors(rows);
  for (const row of rows) {
    if (!row.athleteId) errors[row.id]?.push("Match an existing student");
    if (
      !row.startsOn ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.startsOn) ||
      Number.isNaN(Date.parse(`${row.startsOn}T00:00:00Z`)) ||
      new Date(`${row.startsOn}T00:00:00Z`).toISOString().slice(0, 10) !== row.startsOn
    )
      errors[row.id]?.push("Choose a start date");
    const weeks = row.weeksOfMonth ?? [];
    if (
      (row.frequency === "monthly" && weeks.length !== 1) ||
      (row.frequency === "twice_monthly" && weeks.length !== 2) ||
      new Set(weeks).size !== weeks.length ||
      weeks.some((w) => !Number.isInteger(w) || w < 1 || w > 5)
    )
      errors[row.id]?.push("Choose recurrence weeks");
  }
  return errors;
}

export const CLUB_SCHEDULE_TEMPLATE =
  "coach_name,athlete_first_name,athlete_last_name,age,day,start_time,length_minutes,frequency,guardian_email,athlete_email,sport\nCasey Morgan,Avery,Reed,14,Mon,4:00 PM,45,weekly,parent@example.com,,figure_skating\n";

export function parseClubSchedule(text: string): { rows: ClubScheduleRow[]; error: string | null } {
  const parsed = parseScheduleCsv(text);
  if (parsed.error) return { rows: [], error: parsed.error };
  const first =
    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .find((l) => l.trim() && !l.startsWith("#")) ?? "";
  const [header = [], ...cells] = splitCsv(text, first.includes("\t") ? "\t" : ",");
  const keys = header.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_"),
  );
  const coachIndex = keys.indexOf("coach_name");
  if (coachIndex < 0) return { rows: [], error: "Missing column: coach_name." };
  const ageIndex = keys.indexOf("age");
  return {
    rows: parsed.rows.map((r, i) => {
      const rawAge = ageIndex < 0 ? "" : (cells[i]?.[ageIndex]?.trim() ?? "");
      const age = rawAge ? Number(rawAge) : null;
      return {
        ...r,
        coachName: cells[i]?.[coachIndex]?.trim() ?? "",
        coachId: null,
        age: age !== null && Number.isInteger(age) && age >= 0 && age <= 120 ? age : null,
      };
    }),
    error: null,
  };
}

export function inviteDestination(
  row: ClubScheduleRow,
): "parent" | "adult athlete" | "decide first" {
  if (row.age === null) return "decide first";
  return row.age < 18 ? "parent" : "adult athlete";
}

export function clubScheduleErrors(rows: ClubScheduleRow[]): Record<string, string[]> {
  // Duplicate lessons are scoped to a coach, not the whole club.
  const byCoach = new Map<string, ClubScheduleRow[]>();
  for (const row of rows) {
    const key = row.coachId ?? row.coachName;
    byCoach.set(key, [...(byCoach.get(key) ?? []), row]);
  }
  const errors: Record<string, string[]> = {};
  for (const group of byCoach.values()) {
    const base = validateRows(group);
    for (const row of group) {
      const issues = Object.values(base[row.id] ?? {});
      if (!row.coachId) issues.push("Match a seated coach");
      if (!row.sport.trim()) issues.push("Choose a sport");
      if (row.age === null) issues.push("Confirm age");
      else if (row.age < 18 && !row.guardianEmail.trim()) issues.push("Add a parent email");
      else if (row.age >= 18 && !row.athleteEmail.trim()) issues.push("Add an adult athlete email");
      errors[row.id] = [...new Set(issues)];
    }
  }
  return errors;
}
