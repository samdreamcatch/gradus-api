export type CalendarSlot = {
  id: string;
  athlete_id: string;
  coach_id: string | null;
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  frequency: string;
  starts_on: string | null;
  weeks_of_month: number[];
};
export type CalendarStudent = {
  id: string;
  first_name: string;
  last_name: string;
  parent_id: string | null;
  self_managed: boolean;
  user_id: string | null;
  account_state: string;
  guardian_first_name: string | null;
  guardian_last_name: string | null;
  guardian_email: string | null;
  guardian_invited_at: string | null;
  guardian_claimed_at: string | null;
  invite_recipient: string | null;
};
export type ClubLesson = {
  id: string;
  athleteId: string;
  canInvite: boolean;
  coachId: string;
  coachName: string;
  studentName: string;
  guardianName: string;
  contactEmail: string | null;
  recipient: string;
  invitationStatus: string;
  invitedAt: string | null;
  day: number;
  start: number;
  end: number;
  minutes: number;
  frequency: string;
  startsOn: string | null;
  weeksOfMonth: number[];
  scheduleStatus: string;
  /** Minutes practised on this coach's plans in the last full week (Mon–Sun, UTC). */
  practiceMin: number | null;
  /** Weekly practice target in minutes; null when any of the student's sports has no target. */
  targetMin: number | null;
};

// Called only with club-authorized inputs; require a current coach/student link as well as a slot.
export function buildClubLessons(input: {
  slots: CalendarSlot[];
  students: CalendarStudent[];
  coaches: { id: string; first_name: string | null; last_name: string | null }[];
  links: { coach_id: string; athlete_id: string }[];
  guardians: { athlete_id: string; name: string }[];
}): ClubLesson[] {
  const coaches = new Map(input.coaches.map((c) => [c.id, c]));
  const students = new Map(input.students.map((s) => [s.id, s]));
  const links = new Set(input.links.map((l) => `${l.coach_id}|${l.athlete_id}`));
  return input.slots
    .flatMap((slot): ClubLesson[] => {
      if (!slot.coach_id || !links.has(`${slot.coach_id}|${slot.athlete_id}`)) return [];
      const coach = coaches.get(slot.coach_id);
      const student = students.get(slot.athlete_id);
      if (!coach || !student) return [];
      const adult = student.self_managed || student.invite_recipient === "athlete";
      const names = input.guardians
        .filter((g) => g.athlete_id === student.id)
        .map((g) => g.name)
        .filter(Boolean);
      const guardianName =
        [...new Set(names)].join(", ") ||
        [student.guardian_first_name, student.guardian_last_name].filter(Boolean).join(" ");
      const connected =
        !!student.guardian_claimed_at ||
        !!student.parent_id ||
        (student.self_managed && !!student.user_id);
      const contactEmail = student.guardian_email?.trim() || null;
      return [
        {
          id: slot.id,
          athleteId: student.id,
          canInvite: !connected && !!contactEmail && student.account_state === "active",
          coachId: coach.id,
          coachName: [coach.first_name, coach.last_name].filter(Boolean).join(" "),
          studentName: [student.first_name, student.last_name].filter(Boolean).join(" "),
          guardianName: adult ? "Not required" : guardianName || "Not recorded",
          contactEmail,
          recipient: adult ? "Student" : "Guardian",
          invitationStatus: connected
            ? "Connected"
            : student.guardian_invited_at
              ? "Invite recorded · unclaimed"
              : contactEmail
                ? "Not invited"
                : "Contact missing",
          invitedAt: student.guardian_invited_at,
          day: slot.day_of_week,
          start: slot.start_minute,
          end: slot.end_minute,
          minutes: slot.end_minute - slot.start_minute,
          frequency: slot.frequency,
          startsOn: slot.starts_on,
          weeksOfMonth: slot.weeks_of_month,
          scheduleStatus:
            student.account_state === "active" ? "Scheduled" : `Student ${student.account_state}`,
          practiceMin: null,
          targetMin: null,
        },
      ];
    })
    .sort(
      (a, b) =>
        ((a.day + 6) % 7) - ((b.day + 6) % 7) ||
        a.start - b.start ||
        a.coachName.localeCompare(b.coachName),
    );
}

// ---- Calendar placement (pure; dates are ISO yyyy-mm-dd, computed in UTC to avoid DST drift) ----
/** Review only actionable scheduled families; count students once but retain every lesson. */
export function lessonInvitationReview(lessons: ClubLesson[]) {
  const reviewLessons = lessons.filter((lesson) => lesson.canInvite);
  const students = [...new Map(reviewLessons.map((lesson) => [lesson.athleteId, lesson])).values()];
  return {
    lessons: reviewLessons,
    notInvited: students.filter((lesson) => !lesson.invitedAt),
    awaitingAcceptance: students.filter((lesson) => !!lesson.invitedAt),
  };
}

const DAY_MS = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const toIso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) =>
  toIso(new Date(toDate(iso).getTime() + n * DAY_MS));

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const d = toDate(iso);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}
export function weekDays(iso: string): string[] {
  const start = weekStart(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
/** Six Monday-first weeks covering the month of `iso`. */
export function monthGrid(iso: string): string[] {
  const first = `${iso.slice(0, 7)}-01`;
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Whether a recurring lesson falls on a given date. Missing monthly weeks default to week 1 (monthly) or weeks 1 & 3 (twice a month). */
export function lessonOccursOn(
  lesson: Pick<ClubLesson, "day" | "frequency" | "startsOn" | "weeksOfMonth">,
  iso: string,
): boolean {
  const d = toDate(iso);
  if (d.getUTCDay() !== lesson.day) return false;
  const weekOfMonth = Math.ceil(d.getUTCDate() / 7);
  switch (lesson.frequency) {
    case "biweekly": {
      if (!lesson.startsOn) return true;
      const diff = Math.round(
        (toDate(weekStart(iso)).getTime() - toDate(weekStart(lesson.startsOn)).getTime()) /
          (7 * DAY_MS),
      );
      return diff >= 0 && diff % 2 === 0;
    }
    case "twice_monthly":
      return (lesson.weeksOfMonth.length ? lesson.weeksOfMonth : [1, 3]).includes(weekOfMonth);
    case "monthly":
      return (lesson.weeksOfMonth.length ? lesson.weeksOfMonth : [1]).includes(weekOfMonth);
    default:
      return true;
  }
}

export function lessonsOn<
  T extends Pick<ClubLesson, "day" | "frequency" | "startsOn" | "weeksOfMonth" | "start">,
>(lessons: T[], iso: string): T[] {
  return lessons.filter((l) => lessonOccursOn(l, iso)).sort((a, b) => a.start - b.start);
}

// ---- Practice to target (mirrors the weekly coach snapshot's individual attainment rule) ----
export type PracticeInputs = {
  goals: { athlete_id: string; coach_id: string | null; sport: string; current_level_key: string | null; updated_at: string; id: string }[];
  primaries: { athlete_id: string; sport: string; coach_id: string }[];
  levels: { coach_id: string; sport: string; level_key: string; practice_hours_per_week: number | null }[];
  targets: { coach_id: string; athlete_id: string; sport: string; hours_per_week: number | null }[];
  /** Sessions already limited to the week and to plans owned by `coach_id`. */
  sessions: { coach_id: string; athlete_id: string; duration_seconds: number | null }[];
};
export function practiceFor(coachId: string, athleteId: string, input: PracticeInputs) {
  const bySport = new Map<string, PracticeInputs["goals"][number]>();
  for (const g of [...input.goals]
    .filter((g) => g.athlete_id === athleteId)
    .sort(
      (a, b) =>
        Number(b.coach_id === coachId) - Number(a.coach_id === coachId) ||
        b.updated_at.localeCompare(a.updated_at) ||
        a.id.localeCompare(b.id),
    ))
    if (!bySport.has(g.sport)) bySport.set(g.sport, g);
  const sports = [...bySport.values()].filter((g) =>
    input.primaries.some((p) => p.athlete_id === athleteId && p.sport === g.sport && p.coach_id === coachId),
  );
  let targetMin: number | null = sports.length ? 0 : null;
  for (const g of sports) {
    const own = input.targets.find((t) => t.coach_id === coachId && t.athlete_id === athleteId && t.sport === g.sport)?.hours_per_week;
    const level = input.levels.find((l) => l.coach_id === coachId && l.sport === g.sport && l.level_key === g.current_level_key)?.practice_hours_per_week;
    const hours = own ?? level ?? null;
    if (hours === null || targetMin === null) targetMin = null;
    else targetMin += hours * 60;
  }
  if (targetMin !== null && targetMin <= 0) targetMin = null;
  const practiceMin =
    input.sessions
      .filter((s) => s.coach_id === coachId && s.athlete_id === athleteId)
      .reduce((sum, s) => sum + (s.duration_seconds ?? 0), 0) / 60;
  return { practiceMin: Math.round(practiceMin), targetMin };
}
export type PracticeState = "met" | "below" | "no_target";
export function practiceState(l: Pick<ClubLesson, "practiceMin" | "targetMin">): PracticeState {
  if (l.targetMin === null || l.practiceMin === null) return "no_target";
  return l.practiceMin >= l.targetMin ? "met" : "below";
}

// ---- Compact week view: full rows for hours with lessons, short bands for empty stretches ----
export type HourRow = { kind: "hour"; hour: number; top: number; height: number } | { kind: "gap"; from: number; to: number; top: number; height: number };
export function compactHours(
  lessons: Pick<ClubLesson, "start" | "end">[],
  hourPx: number,
  gapPx: number,
): { rows: HourRow[]; height: number; y: (minute: number) => number } {
  if (!lessons.length) {
    const rows: HourRow[] = Array.from({ length: 10 }, (_, i) => ({ kind: "hour", hour: 8 + i, top: i * hourPx, height: hourPx }));
    return { rows, height: 10 * hourPx, y: (m) => ((m - 480) / 60) * hourPx };
  }
  const busy = new Set<number>();
  for (const l of lessons)
    for (let h = Math.floor(l.start / 60); h < Math.max(Math.ceil(l.end / 60), Math.floor(l.start / 60) + 1); h++) busy.add(h);
  const first = Math.min(...busy);
  const last = Math.max(...busy);
  const rows: HourRow[] = [];
  let top = 0;
  for (let h = first; h <= last; ) {
    if (busy.has(h)) {
      rows.push({ kind: "hour", hour: h, top, height: hourPx });
      top += hourPx;
      h++;
    } else {
      let to = h;
      while (!busy.has(to)) to++;
      rows.push({ kind: "gap", from: h, to, top, height: gapPx });
      top += gapPx;
      h = to;
    }
  }
  const y = (minute: number) => {
    const h = Math.floor(minute / 60);
    const row = rows.find((r) => r.kind === "hour" && r.hour === h);
    if (row) return row.top + ((minute - h * 60) / 60) * hourPx;
    const gap = rows.find((r) => r.kind === "gap" && h >= r.from && h < r.to);
    if (gap) return gap.top + gap.height;
    return minute < first * 60 ? 0 : top;
  };
  return { rows, height: top, y };
}
