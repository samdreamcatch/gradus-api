import type { ClubLesson } from "./club-lesson-calendar";

/** Reminders only target recorded, still-actionable invitations, once per student. */
export function lessonReminderRecipients(rows: ClubLesson[]): ClubLesson[] {
  return [...new Map(rows.filter((r) => r.canInvite && !!r.invitedAt)
    .map((r) => [r.athleteId, r])).values()];
}