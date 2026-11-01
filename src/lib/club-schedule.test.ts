import { describe, expect, it } from "bun:test";
import { clubScheduleErrors, inviteDestination, parseClubSchedule, type ClubScheduleRow } from "./club-schedule";

const row: ClubScheduleRow = { id: "1", firstName: "Avery", lastName: "Reed", coachName: "Casey", coachId: "coach", age: 17, dayOfWeek: 1, startMinute: 960, lengthMinutes: 45, frequency: "weekly", sport: "figure_skating", guardianEmail: "parent@example.com", athleteEmail: "", };
describe("Club schedule review", () => {
  it("routes under-18s to parents and 18-year-olds to adult athlete invitations", () => {
    expect(inviteDestination(row)).toBe("parent");
    expect(inviteDestination({ ...row, age: 18 })).toBe("adult athlete");
    expect(inviteDestination({ ...row, age: null })).toBe("decide first");
  });
  it("never treats an athlete email as enough for a minor", () => {
    expect(clubScheduleErrors([{ ...row, guardianEmail: "", athleteEmail: "athlete@example.com" }])["1"]).toContain("Add a parent email");
  });
  it("requires an adult athlete email for adults", () => {
    expect(clubScheduleErrors([{ ...row, age: 18 }])["1"]).toContain("Add an adult athlete email");
  });
  it("blocks unmatched coaches and uncertain ages", () => {
    const issues = clubScheduleErrors([{ ...row, coachId: null, age: null }])["1"];
    expect(issues).toContain("Match a seated coach");
    expect(issues).toContain("Confirm age");
  });
  it("keeps coach attribution and quoted names from CSV", () => {
    const result = parseClubSchedule('coach_name,athlete_first_name,athlete_last_name,age,day,start_time\n"Morgan, Casey",Avery,Reed,17,Mon,4pm');
    expect(result.error).toBeNull();
    expect(result.rows[0]?.coachName).toBe("Morgan, Casey");
    expect(result.rows[0]?.age).toBe(17);
    expect(result.rows[0]?.startMinute).toBe(960);
  });
  it("detects duplicates within the same coach only", () => {
    expect(clubScheduleErrors([row, { ...row, id: "2" }])["2"]).toContain("Duplicate — same athlete, same day and time");
    expect(clubScheduleErrors([row, { ...row, id: "2", coachId: "other" }])["2"]).toEqual([]);
  });
});