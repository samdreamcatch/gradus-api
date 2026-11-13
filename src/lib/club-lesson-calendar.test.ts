import { describe, expect, it } from "bun:test";
import { buildClubLessons, lessonInvitationReview, type CalendarSlot, type CalendarStudent } from "./club-lesson-calendar";

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
  it("counts each uninvited student once while retaining all scheduled lessons for review", () => {
    const review = lessonInvitationReview(buildClubLessons({
      ...input,
      slots: [slot, { ...slot, id: "second", day_of_week: 6 }],
    }));
    expect(review.notInvited.map((lesson) => lesson.athleteId)).toEqual(["student"]);
    expect(review.lessons.map((lesson) => lesson.id)).toEqual(["morning", "second"]);
  });
  it("separates recorded invitations from the unsent bulk invitation list", () => {
    const review = lessonInvitationReview(buildClubLessons({
      ...input,
      students: [{ ...student, guardian_invited_at: "2026-11-01T00:00:00Z" }],
    }));
    expect(review.notInvited).toEqual([]);
    expect(review.awaitingAcceptance.map((lesson) => lesson.athleteId)).toEqual(["student"]);
  });
  it("excludes connected and paused students from actionable invitation review", () => {
    for (const changed of [{ parent_id: "parent" }, { account_state: "paused" }]) {
      const review = lessonInvitationReview(buildClubLessons({ ...input, students: [{ ...student, ...changed }] }));
      expect(review.lessons).toEqual([]);
    }
  });
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

import { compactHours, practiceFor, practiceState } from "./club-lesson-calendar";
describe("lesson practice to target", () => {
  const base = {
    goals: [{ id: "g", athlete_id: "a", coach_id: "c", sport: "skate", current_level_key: "bronze", updated_at: "2026-01-01" }],
    primaries: [{ athlete_id: "a", sport: "skate", coach_id: "c" }],
    levels: [{ coach_id: "c", sport: "skate", level_key: "bronze", practice_hours_per_week: 2 }],
    targets: [],
    sessions: [{ coach_id: "c", athlete_id: "a", duration_seconds: 3600 }],
  };
  it("uses the level target and last week's practice", () => {
    const p = practiceFor("c", "a", base);
    expect(p).toEqual({ practiceMin: 60, targetMin: 120 });
    expect(practiceState(p)).toBe("below");
  });
  it("prefers the coach's own target for the student", () => {
    const p = practiceFor("c", "a", { ...base, targets: [{ coach_id: "c", athlete_id: "a", sport: "skate", hours_per_week: 1 }] });
    expect(practiceState(p)).toBe("met");
  });
  it("reports no target when a sport has none", () => {
    const p = practiceFor("c", "a", { ...base, levels: [] });
    expect(practiceState(p)).toBe("no_target");
  });
});
describe("compact week hours", () => {
  it("keeps only busy hours and collapses empty stretches", () => {
    const { rows } = compactHours([{ start: 360, end: 420 }, { start: 1020, end: 1080 }], 56, 24);
    expect(rows.map((r) => r.kind)).toEqual(["hour", "gap", "hour"]);
    expect(rows[1]).toMatchObject({ from: 7, to: 17 });
  });
});
