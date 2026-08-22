/**
 * Shared (client-safe) helpers for the coach "import schedule" flow.
 * The CSV parser, the AI vision parser and the manual editor all produce the
 * same `ImportRow` shape, so the review table and the commit server function
 * only ever deal with one format.
 */

export const IMPORT_FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every other week" },
  { value: "twice_monthly", label: "Twice a month" },
  { value: "monthly", label: "Monthly" },
] as const;

export type ImportFrequency = (typeof IMPORT_FREQUENCIES)[number]["value"];

export const IMPORT_DAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
] as const;

export type ImportRow = {
  /** Client-side row id (not persisted). */
  id: string;
  firstName: string;
  lastName: string;
  dayOfWeek: number | null;
  startMinute: number | null;
  lengthMinutes: number | null;
  frequency: ImportFrequency;
  guardianEmail: string;
  athleteEmail: string;
  sport: string;
  /**
   * Fields that came in from a CSV or a photo with something written that we
   * couldn't understand. Surfaced in review as "couldn't read — confirm"
   * instead of being silently defaulted.
   */
  unreadable?: Partial<Record<"dayOfWeek" | "startMinute" | "lengthMinutes", true>>;
};

export type RowErrors = Partial<Record<keyof ImportRow, string>>;

let rowSeq = 0;
export function newRowId(): string {
  rowSeq += 1;
  return `r${rowSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blankRow(sport = ""): ImportRow {
  return {
    id: newRowId(),
    firstName: "",
    lastName: "",
    dayOfWeek: null,
    startMinute: null,
    lengthMinutes: 60,
    frequency: "weekly",
    guardianEmail: "",
    athleteEmail: "",
    sport,
  };
}


// ---------- field parsers ----------

const DAY_ALIASES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  su: 0,
  mon: 1,
  monday: 1,
  m: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  tu: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  w: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  th: 4,
  fri: 5,
  friday: 5,
  f: 5,
  sat: 6,
  saturday: 6,
  sa: 6,
};

export function parseDay(value: string): number | null {
  const key = value.trim().toLowerCase().replace(/\.$/, "");
  if (!key) return null;
  if (key in DAY_ALIASES) return DAY_ALIASES[key];
  const n = Number(key);
  if (Number.isInteger(n) && n >= 0 && n <= 6) return n;
  return null;
}

/** Accepts "16:00", "4:00 PM", "4pm", "4.30pm", "1600". */
export function parseTimeToMinutes(value: string): number | null {
  const raw = value.trim().toLowerCase().replace(/\s+/g, "");
  if (!raw) return null;
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)?$/.exec(raw);
  if (m) {
    let h = Number(m[1]);
    const mins = m[2] ? Number(m[2]) : 0;
    const mer = m[3];
    if (mins > 59) return null;
    if (mer === "pm" || mer === "p") {
      if (h < 12) h += 12;
    } else if (mer === "am" || mer === "a") {
      if (h === 12) h = 0;
    }
    if (h > 23) return null;
    return h * 60 + mins;
  }
  const compact = /^(\d{3,4})$/.exec(raw);
  if (compact) {
    const n = Number(compact[1]);
    const h = Math.floor(n / 100);
    const mins = n % 100;
    if (h > 23 || mins > 59) return null;
    return h * 60 + mins;
  }
  return null;
}

/** Accepts "60", "60 min", "1 hr", "1.5 hours", "0:45". */
export function parseLengthToMinutes(value: string): number | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const num = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/.exec(raw);
  if (!num) return null;
  const n = Number(num[1]);
  const unit = num[2];
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit.startsWith("h")) return Math.round(n * 60);
  return Math.round(n);
}

export function parseFrequency(value: string): ImportFrequency {
  const raw = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return "weekly";
  if (raw.includes("biweek") || raw.includes("every_other") || raw.includes("alternate")) {
    return "biweekly";
  }
  if (raw.includes("twice")) return "twice_monthly";
  if (raw.startsWith("month")) return "monthly";
  return "weekly";
}

export function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function hhmmToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

export function formatTimeLabel(minute: number): string {
  const h24 = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h24 >= 12 ? "pm" : "am";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

// ---------- validation ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRow(row: ImportRow): RowErrors {
  const errors: RowErrors = {};
  if (!row.firstName.trim()) errors.firstName = "Required";
  if (!row.lastName.trim()) errors.lastName = "Required";
  if (row.dayOfWeek == null) {
    errors.dayOfWeek = row.unreadable?.dayOfWeek ? "Couldn't read the day — pick one" : "Pick a day";
  }
  if (row.startMinute == null) {
    errors.startMinute = row.unreadable?.startMinute
      ? "Couldn't read that time — e.g. 4:00 PM"
      : "Add a start time";
  }
  if (row.lengthMinutes == null || row.lengthMinutes <= 0) {
    errors.lengthMinutes = "Pick how long it runs";
  }
  if (row.startMinute != null && row.lengthMinutes != null) {
    if (row.startMinute + row.lengthMinutes > 1440) errors.lengthMinutes = "Runs past midnight";
  }
  const guardian = row.guardianEmail.trim();
  const athlete = row.athleteEmail.trim();
  if (!guardian && !athlete) {
    errors.guardianEmail = "Required for under 18 — or add an athlete email instead";
  }
  if (guardian && !EMAIL_RE.test(guardian)) errors.guardianEmail = "e.g. parent@example.com";
  if (athlete && !EMAIL_RE.test(athlete)) errors.athleteEmail = "e.g. athlete@example.com";
  return errors;
}

/**
 * Validate the whole table so we can also flag duplicates — the same athlete
 * at the same day and time twice, which the commit step would silently skip.
 */
export function validateRows(rows: ImportRow[]): Record<string, RowErrors> {
  const out: Record<string, RowErrors> = {};
  const seen = new Map<string, string>();
  for (const row of rows) {
    const errors = validateRow(row);
    if (row.dayOfWeek != null && row.startMinute != null && row.firstName && row.lastName) {
      const key = [
        row.firstName.trim().toLowerCase(),
        row.lastName.trim().toLowerCase(),
        row.dayOfWeek,
        row.startMinute,
      ].join("|");
      if (seen.has(key)) {
        errors.startMinute = "Duplicate — same athlete, same day and time";
      } else {
        seen.set(key, row.id);
      }
    }
    out[row.id] = errors;
  }
  return out;
}

export function rowHasErrors(row: ImportRow): boolean {
  return Object.keys(validateRow(row)).length > 0;
}


// ---------- grouping ----------

export type AthleteGroup = {
  key: string;
  firstName: string;
  lastName: string;
  guardianEmail: string;
  athleteEmail: string;
  sport: string;
  rows: ImportRow[];
};

export function groupRowsByAthlete(rows: ImportRow[]): AthleteGroup[] {
  const map = new Map<string, AthleteGroup>();
  for (const row of rows) {
    const email = (row.guardianEmail || row.athleteEmail).trim().toLowerCase();
    const key = `${row.firstName.trim().toLowerCase()}|${row.lastName.trim().toLowerCase()}|${email}`;
    const existing = map.get(key);
    if (existing) {
      existing.rows.push(row);
      if (!existing.guardianEmail) existing.guardianEmail = row.guardianEmail.trim();
      if (!existing.athleteEmail) existing.athleteEmail = row.athleteEmail.trim();
      if (!existing.sport) existing.sport = row.sport;
      continue;
    }
    map.set(key, {
      key,
      firstName: row.firstName.trim(),
      lastName: row.lastName.trim(),
      guardianEmail: row.guardianEmail.trim(),
      athleteEmail: row.athleteEmail.trim(),
      sport: row.sport,
      rows: [row],
    });
  }
  return [...map.values()];
}

// ---------- CSV ----------

export const CSV_HEADERS = [
  "athlete_first_name",
  "athlete_last_name",
  "day",
  "start_time",
  "length_minutes",
  "frequency",
  "guardian_email",
  "athlete_email",
  "sport",
] as const;

/**
 * The downloadable template carries its own instructions. Every line starting
 * with `#` is skipped by the parser, so a coach can fill the file in and
 * re-upload it without deleting anything.
 */
export const CSV_TEMPLATE = `# GRADUS LESSON SCHEDULE — fill in one row per weekly lesson, then upload this file.
# Lines starting with # are ignored. Keep the header row below. Delete the example rows.
#
# athlete_first_name  Required.
# athlete_last_name   Required.
# day                 Mon / Monday / Tue ... any spelling works.
# start_time          4:00 PM  or  4pm  or  16:00  or  1600
# length_minutes      45  or  60  or  "1 hr"  or  "1.5 hours"
# frequency           weekly | every other week | twice a month | monthly
# guardian_email      Required for anyone under 18. We email them an invite.
# athlete_email       Use this instead for adult (18+) athletes.
# sport               Leave blank to use your sport.
#
${CSV_HEADERS.join(",")}
Ava,Nguyen,Mon,4:00 PM,45,weekly,parent@example.com,,
Liam,Brooks,Wed,17:30,60,every other week,parent2@example.com,,
Jordan,Reyes,Sat,9:00 AM,1 hr,weekly,,jordan@example.com,
`;

/**
 * Minimal RFC-4180-ish splitter (handles quoted fields). Skips `#` comment
 * lines and blank lines. Pass a tab delimiter to parse spreadsheet pastes.
 */
export function splitCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(
    (r) => r.some((cell) => cell.trim() !== "") && !r[0].trim().startsWith("#"),
  );

}

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const HEADER_ALIASES: Record<string, string> = {
  first_name: "athlete_first_name",
  first: "athlete_first_name",
  athlete_first: "athlete_first_name",
  last_name: "athlete_last_name",
  last: "athlete_last_name",
  athlete_last: "athlete_last_name",
  day_of_week: "day",
  weekday: "day",
  start: "start_time",
  time: "start_time",
  start_minute: "start_time",
  length: "length_minutes",
  duration: "length_minutes",
  lesson_length: "length_minutes",
  minutes: "length_minutes",
  repeat: "frequency",
  recurrence: "frequency",
  parent_email: "guardian_email",
  guardian: "guardian_email",
  parent: "guardian_email",
  email: "guardian_email",
  athlete_email_address: "athlete_email",
};

export type CsvParseResult = { rows: ImportRow[]; error: string | null };

function unreadableFlags(
  dayRaw: string,
  dayOfWeek: number | null,
  timeRaw: string,
  startMinute: number | null,
  lengthRaw: string,
  lengthMinutes: number | null,
): ImportRow["unreadable"] {
  const flags: NonNullable<ImportRow["unreadable"]> = {};
  if (dayRaw && dayOfWeek == null) flags.dayOfWeek = true;
  if (timeRaw && startMinute == null) flags.startMinute = true;
  if (lengthRaw && lengthMinutes == null) flags.lengthMinutes = true;
  return Object.keys(flags).length > 0 ? flags : undefined;
}

export function parseScheduleCsv(text: string, defaultSport = ""): CsvParseResult {
  const delimiter = pickDelimiter(text);
  const table = splitCsv(text, delimiter);
  if (table.length === 0) return { rows: [], error: "That file looks empty." };
  const header = table[0].map((h) => {
    const k = headerKey(h);
    return HEADER_ALIASES[k] ?? k;
  });
  const required = ["athlete_first_name", "athlete_last_name", "day", "start_time"];
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length > 0) {
    return {
      rows: [],
      error: `Missing column(s): ${missing.join(", ")}. Download the template for the exact headers.`,
    };
  }
  const idx = (name: string) => header.indexOf(name);
  const cell = (r: string[], name: string) => {
    const i = idx(name);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };

  const rows: ImportRow[] = table.slice(1).map((r) => {
    const dayRaw = cell(r, "day");
    const timeRaw = cell(r, "start_time");
    const lengthRaw = cell(r, "length_minutes");
    const dayOfWeek = parseDay(dayRaw);
    const startMinute = parseTimeToMinutes(timeRaw);
    const parsedLength = parseLengthToMinutes(lengthRaw);
    return {
      id: newRowId(),
      firstName: cell(r, "athlete_first_name"),
      lastName: cell(r, "athlete_last_name"),
      dayOfWeek,
      startMinute,
      lengthMinutes: parsedLength ?? (lengthRaw ? null : 60),
      frequency: parseFrequency(cell(r, "frequency")),
      guardianEmail: cell(r, "guardian_email").toLowerCase(),
      athleteEmail: cell(r, "athlete_email").toLowerCase(),
      sport: cell(r, "sport") || defaultSport,
      unreadable: unreadableFlags(
        dayRaw,
        dayOfWeek,
        timeRaw,
        startMinute,
        lengthRaw,
        parsedLength,
      ),
    };
  });

  if (rows.length === 0) return { rows: [], error: "No lesson rows found in that file." };
  return { rows, error: null };
}

/** Tab-separated when it looks like a spreadsheet paste, comma otherwise. */
function pickDelimiter(text: string): string {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "";
  return firstLine.includes("\t") ? "\t" : ",";
}

/** Parse text pasted straight out of Excel / Sheets (tab- or comma-separated). */
export function parsePastedSchedule(text: string, defaultSport = ""): CsvParseResult {
  if (!text.trim()) return { rows: [], error: "Nothing pasted yet." };
  return parseScheduleCsv(text, defaultSport);
}


/** Turn the AI vision output into review rows. */
export function rowsFromParsedLessons(
  lessons: {
    firstName: string;
    lastName: string;
    day: string;
    startTime: string;
    lengthMinutes: number | null;
    frequency: string;
    guardianEmail: string | null;
    athleteEmail: string | null;
  }[],
  defaultSport = "",
): ImportRow[] {
  return lessons.map((l) => ({
    id: newRowId(),
    firstName: l.firstName.trim(),
    lastName: l.lastName.trim(),
    dayOfWeek: parseDay(l.day),
    startMinute: parseTimeToMinutes(l.startTime),
    lengthMinutes: l.lengthMinutes && l.lengthMinutes > 0 ? l.lengthMinutes : 60,
    frequency: parseFrequency(l.frequency),
    guardianEmail: (l.guardianEmail ?? "").trim().toLowerCase(),
    athleteEmail: (l.athleteEmail ?? "").trim().toLowerCase(),
    sport: defaultSport,
  }));
}
