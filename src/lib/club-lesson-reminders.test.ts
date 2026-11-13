import { expect, it } from "bun:test";
import { lessonReminderRecipients } from "./club-lesson-reminders";
import type { ClubLesson } from "./club-lesson-calendar";

const lesson = { athleteId: "student", canInvite: true, invitedAt: "2026-11-01" } as ClubLesson;
it("only reminds recorded actionable invitations", () => {
  expect(lessonReminderRecipients([lesson, { ...lesson, athleteId: "joined", canInvite: false },
    { ...lesson, athleteId: "unsent", invitedAt: null }]).map((r) => r.athleteId)).toEqual(["student"]);
});
it("deduplicates students with multiple lessons", () => {
  expect(lessonReminderRecipients([lesson, { ...lesson, id: "second" }])).toHaveLength(1);
});