import { parseScheduleCsv, splitCsv, validateRows, type ImportRow } from "./schedule-import";

export type ClubScheduleRow = ImportRow & {
  coachName: string;
  coachId: string | null;
  age: number | null;
};

export const CLUB_SCHEDULE_TEMPLATE = "coach_name,athlete_first_name,athlete_last_name,age,day,start_time,length_minutes,frequency,guardian_email,athlete_email,sport\nCasey Morgan,Avery,Reed,14,Mon,4:00 PM,45,weekly,parent@example.com,,figure_skating\n";

export function parseClubSchedule(text: string): { rows: ClubScheduleRow[]; error: string | null } {
  const parsed = parseScheduleCsv(text);
  if (parsed.error) return { rows: [], error: parsed.error };
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#")) ?? "";
  const [header = [], ...cells] = splitCsv(text, first.includes("\t") ? "\t" : ",");
  const keys = header.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const coachIndex = keys.indexOf("coach_name");
  if (coachIndex < 0) return { rows: [], error: "Missing column: coach_name." };
  const ageIndex = keys.indexOf("age");
  return { rows: parsed.rows.map((r, i) => {
    const rawAge = ageIndex < 0 ? "" : cells[i]?.[ageIndex]?.trim() ?? "";
    const age = rawAge ? Number(rawAge) : null;
    return { ...r, coachName: cells[i]?.[coachIndex]?.trim() ?? "", coachId: null,
      age: age !== null && Number.isInteger(age) && age >= 0 && age <= 120 ? age : null };
  }), error: null };
}

export function inviteDestination(row: ClubScheduleRow): "parent" | "adult athlete" | "decide first" {
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