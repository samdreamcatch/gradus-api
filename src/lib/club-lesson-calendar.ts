export type CalendarSlot = { id: string; athlete_id: string; coach_id: string | null; day_of_week: number; start_minute: number; end_minute: number; frequency: string; starts_on: string | null; weeks_of_month: number[] };
export type CalendarStudent = { id: string; first_name: string; last_name: string; parent_id: string | null; self_managed: boolean; user_id: string | null; account_state: string; guardian_first_name: string | null; guardian_last_name: string | null; guardian_email: string | null; guardian_invited_at: string | null; guardian_claimed_at: string | null; invite_recipient: string | null };
export type ClubLesson = {
  id: string; coachId: string; coachName: string; studentName: string; guardianName: string;
  contactEmail: string | null; recipient: string; invitationStatus: string; invitedAt: string | null;
  day: number; start: number; end: number; minutes: number; frequency: string;
  startsOn: string | null; weeksOfMonth: number[]; scheduleStatus: string;
};

// Called only with club-authorized inputs; require a current coach/student link as well as a slot.
export function buildClubLessons(input: {
  slots: CalendarSlot[]; students: CalendarStudent[];
  coaches: { id: string; first_name: string | null; last_name: string | null }[];
  links: { coach_id: string; athlete_id: string }[];
  guardians: { athlete_id: string; name: string }[];
}): ClubLesson[] {
  const coaches = new Map(input.coaches.map((c) => [c.id, c]));
  const students = new Map(input.students.map((s) => [s.id, s]));
  const links = new Set(input.links.map((l) => `${l.coach_id}|${l.athlete_id}`));
  return input.slots.flatMap((slot): ClubLesson[] => {
    if (!slot.coach_id || !links.has(`${slot.coach_id}|${slot.athlete_id}`)) return [];
    const coach = coaches.get(slot.coach_id);
    const student = students.get(slot.athlete_id);
    if (!coach || !student) return [];
    const adult = student.self_managed || student.invite_recipient === "athlete";
    const names = input.guardians.filter((g) => g.athlete_id === student.id).map((g) => g.name).filter(Boolean);
    const guardianName = [...new Set(names)].join(", ") || [student.guardian_first_name, student.guardian_last_name].filter(Boolean).join(" ");
    const connected = !!student.guardian_claimed_at || !!student.parent_id || (student.self_managed && !!student.user_id);
    const contactEmail = student.guardian_email?.trim() || null;
    return [{
      id: slot.id, coachId: coach.id, coachName: [coach.first_name, coach.last_name].filter(Boolean).join(" "),
      studentName: [student.first_name, student.last_name].filter(Boolean).join(" "), guardianName: adult ? "Not required" : guardianName || "Not recorded",
      contactEmail, recipient: adult ? "Student" : "Guardian",
      invitationStatus: connected ? "Connected" : student.guardian_invited_at ? "Invite recorded · unclaimed" : contactEmail ? "Not invited" : "Contact missing",
      invitedAt: student.guardian_invited_at, day: slot.day_of_week, start: slot.start_minute, end: slot.end_minute,
      minutes: slot.end_minute - slot.start_minute, frequency: slot.frequency, startsOn: slot.starts_on,
      weeksOfMonth: slot.weeks_of_month, scheduleStatus: student.account_state === "active" ? "Scheduled" : `Student ${student.account_state}`,
    }];
  }).sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7) || a.start - b.start || a.coachName.localeCompare(b.coachName));
}