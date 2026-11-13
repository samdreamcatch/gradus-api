/**
 * Pure rules for the club "Add students" sheet: row checks, spreadsheet paste parsing and
 * invite status. Shared by the sheet (live row checks) and the server (final say).
 */
export type StudentFrequency = "weekly" | "biweekly" | "twice_monthly" | "monthly";

export type StudentRow = {
  id: string;
  coachId: string;
  firstName: string;
  lastName: string;
  adult: boolean;
  guardianFirstName: string;
  guardianLastName: string;
  email: string;
  /** 0 = Sunday … 6 = Saturday; null = no lesson yet. */
  dayOfWeek: number | null;
  /** "HH:MM" 24h, or "" for no lesson. */
  start: string;
  lengthMinutes: number;
  frequency: StudentFrequency;
  currentLevelKey: string;
  seasonGoalKey: string;
};

export const LENGTH_PRESETS = [30, 45, 60, 90] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let seq = 0;
export function blankStudentRow(coachId = ""): StudentRow {
  seq += 1;
  return {
    id: `row-${Date.now().toString(36)}-${seq}`,
    coachId,
    firstName: "",
    lastName: "",
    adult: false,
    guardianFirstName: "",
    guardianLastName: "",
    email: "",
    dayOfWeek: null,
    start: "",
    lengthMinutes: 60,
    frequency: "weekly",
    currentLevelKey: "",
    seasonGoalKey: "",
  };
}

export function isBlankRow(r: StudentRow): boolean {
  return !r.firstName.trim() && !r.lastName.trim() && !r.email.trim();
}

export function nameKey(first: string, last: string): string {
  return `${first.trim().toLowerCase()} ${last.trim().toLowerCase()}`.replace(/\s+/g, " ");
}

export function parseStartMinute(start: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(start.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Problems that stop a row from being added. `existing` holds the coach's current students as
 * `coachId|nameKey`; `seated` lists coaches who hold a club seat.
 */
export function studentRowProblems(
  row: StudentRow,
  ctx: { seated: ReadonlySet<string>; existing: ReadonlySet<string>; others: StudentRow[] },
): string[] {
  const out: string[] = [];
  if (!row.coachId) out.push("Pick a coach");
  else if (!ctx.seated.has(row.coachId)) out.push("This coach doesn't hold a club seat");
  if (!row.firstName.trim() || !row.lastName.trim()) out.push("Add first and last name");
  const email = row.email.trim();
  if (!email) out.push(row.adult ? "Add the athlete's email" : "Add a parent or guardian email");
  else if (!EMAIL.test(email)) out.push("Check the email");
  const hasDay = row.dayOfWeek !== null;
  const hasStart = row.start.trim() !== "";
  if (hasDay !== hasStart) out.push(hasDay ? "Add a start time" : "Pick a day");
  if (hasStart && parseStartMinute(row.start) === null) out.push("Check the start time");
  if (hasStart && (row.lengthMinutes < 5 || row.lengthMinutes > 600))
    out.push("Length must be 5–600 minutes");
  if (Boolean(row.currentLevelKey) !== Boolean(row.seasonGoalKey))
    out.push("Pick both starting levels, or neither");
  const key = nameKey(row.firstName, row.lastName);
  if (row.coachId && key.trim()) {
    if (ctx.existing.has(`${row.coachId}|${key}`)) out.push("Already on this coach's roster");
    else if (
      ctx.others.some(
        (o) =>
          o.id !== row.id && o.coachId === row.coachId && nameKey(o.firstName, o.lastName) === key,
      )
    )
      out.push("Listed twice");
  }
  return out;
}

const DAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

export function parseDay(value: string): number | null {
  return DAYS[value.trim().toLowerCase()] ?? null;
}

/** "4:00 PM", "16:00", "4pm" → "16:00"; anything else → "". */
export function normalizeStart(value: string): string {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?$/i.exec(value.trim());
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3]!.toLowerCase() === "p") h += 12;
    const min = Number(m[2] ?? "0");
    if (min > 59) return "";
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  return parseStartMinute(value) === null ? "" : value.trim().padStart(5, "0");
}

/**
 * Rows pasted from a spreadsheet (tab or comma separated), in this column order:
 * first, last, email, under/over 18, day, start, length, guardian first, guardian last.
 * A header row is skipped. Missing cells stay blank for the admin to fill in.
 */
export function parsePastedStudents(text: string, coachId: string): StudentRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: StudentRow[] = [];
  for (const line of lines) {
    const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
    if (/^first/i.test(cells[0] ?? "")) continue;
    const row = blankStudentRow(coachId);
    row.firstName = cells[0] ?? "";
    row.lastName = cells[1] ?? "";
    row.email = (cells[2] ?? "").toLowerCase();
    row.adult = /over|adult|18\+|^a$/i.test(cells[3] ?? "");
    row.dayOfWeek = cells[4] ? parseDay(cells[4]) : null;
    row.start = cells[5] ? normalizeStart(cells[5]) : "";
    const len = Number.parseInt(cells[6] ?? "", 10);
    if (Number.isFinite(len) && len > 0) row.lengthMinutes = len;
    row.guardianFirstName = cells[7] ?? "";
    row.guardianLastName = cells[8] ?? "";
    if (!isBlankRow(row)) rows.push(row);
  }
  return rows;
}

export type ClubInviteStatus = "Joined" | "Invited" | "Not invited" | "Missing email";

export function clubInviteStatus(s: {
  joined: boolean;
  email: string | null;
  invitedAt: string | null;
}): ClubInviteStatus {
  if (s.joined) return "Joined";
  if (!s.email?.trim()) return "Missing email";
  return s.invitedAt ? "Invited" : "Not invited";
}
