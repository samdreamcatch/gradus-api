import { describe, expect, it } from "bun:test";
import { buildClubLessons, type CalendarSlot, type CalendarStudent } from "./club-lesson-calendar";

const student: CalendarStudent = {
  id: "student",
  first_name: "Avery",
  last_name: "Reed",
  parent_id: null,
  self_managed: false,
  user_id: null,
  account_state: "active",
  guardian_first_name: "Jordan",
  guardian_last_name: "Reed",
  guardian_email: "guardian@example.com",
  guardian_invited_at: null,
  guardian_claimed_at: null,
  invite_recipient: "guardian",
};
const slot: CalendarSlot = {
  id: "morning",
  athlete_id: "student",
  coach_id: "coach",
  day_of_week: 1,
  start_minute: 510,
  end_minute: 555,
  frequency: "weekly",
  starts_on: "2026-11-02",
  weeks_of_month: [],
};
const input = {
  slots: [slot],
  students: [student],
  coaches: [{ id: "coach", first_name: "Casey", last_name: "Morgan" }],
  links: [{ coach_id: "coach", athlete_id: "student" }],
  guardians: [],
};
describe("Club lesson calendar", () => {
  it("returns one row per lesson with its own start and end instead of a daily span", () => {
    const lessons = buildClubLessons({
      ...input,
      slots: [slot, { ...slot, id: "afternoon", start_minute: 960, end_minute: 1005 }],
    });
    expect(lessons.map((l) => [l.id, l.start, l.end, l.minutes])).toEqual([
      ["morning", 510, 555, 45],
      ["afternoon", 960, 1005, 45],
    ]);
  });
  it("includes student and guardian plus the recorded invitation contact", () => {
    expect(buildClubLessons(input)[0]).toMatchObject({
      studentName: "Avery Reed",
      guardianName: "Jordan Reed",
      contactEmail: "guardian@example.com",
      recipient: "Guardian",
    });
  });
  it("excludes lessons without a current authorized coach/student pair", () => {
    expect(buildClubLessons({ ...input, links: [] })).toEqual([]);
    expect(buildClubLessons({ ...input, coaches: [] })).toEqual([]);
  });
  it("offers an invite only to active, unclaimed students with an email", () => {
    expect(buildClubLessons(input)[0]?.canInvite).toBe(true);
    expect(
      buildClubLessons({
        ...input,
        students: [{ ...student, guardian_claimed_at: "2026-11-01T00:00:00Z" }],
      })[0]?.canInvite,
    ).toBe(false);
    expect(
      buildClubLessons({ ...input, students: [{ ...student, guardian_email: null }] })[0]
        ?.canInvite,
    ).toBe(false);
    expect(
      buildClubLessons({ ...input, students: [{ ...student, account_state: "paused" }] })[0]
        ?.canInvite,
    ).toBe(false);
  });
  it("does not infer successful email delivery from a recorded invitation date", () => {
    expect(
      buildClubLessons({
        ...input,
        students: [{ ...student, guardian_invited_at: "2026-11-01T00:00:00Z" }],
      })[0]?.invitationStatus,
    ).toBe("Invite recorded · unclaimed");
  });
});
import { lessonOccursOn, monthGrid, weekDays } from "./club-lesson-calendar";
describe("Club lesson calendar placement", () => {
  const base = { day: 2, startsOn: null, weeksOfMonth: [] as number[] }; // Tuesday
  it("weeks start on Monday", () => {
    expect(weekDays("2026-11-05")[0]).toBe("2026-11-02");
    expect(weekDays("2026-11-05")[6]).toBe("2026-11-08");
  });
  it("month grid covers six weeks starting the Monday before the 1st", () => {
    const g = monthGrid("2026-11-20");
    expect(g.length).toBe(42);
    expect(g[0]).toBe("2026-10-26");
  });
  it("weekly lessons land on every matching weekday only", () => {
    expect(lessonOccursOn({ ...base, frequency: "weekly" }, "2026-11-03")).toBe(true);
    expect(lessonOccursOn({ ...base, frequency: "weekly" }, "2026-11-04")).toBe(false);
  });
  it("every-other-week lessons skip alternate weeks from their start date", () => {
    const l = { ...base, frequency: "biweekly", startsOn: "2026-11-03" };
    expect(lessonOccursOn(l, "2026-11-03")).toBe(true);
    expect(lessonOccursOn(l, "2026-11-10")).toBe(false);
    expect(lessonOccursOn(l, "2026-11-17")).toBe(true);
    expect(lessonOccursOn(l, "2026-10-27")).toBe(false);
  });
  it("monthly lessons use the chosen week of the month", () => {
    const l = { ...base, frequency: "monthly", weeksOfMonth: [2] };
    expect(lessonOccursOn(l, "2026-11-10")).toBe(true);
    expect(lessonOccursOn(l, "2026-11-03")).toBe(false);
  });
});
