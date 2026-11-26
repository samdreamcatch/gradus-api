import { describe, expect, it } from "bun:test";
import {
  blankStudentRow,
  clubInviteStatus,
  normalizeStart,
  parsePastedStudents,
  studentRowProblems,
  type StudentRow,
} from "./club-add-students";

const coach = "11111111-1111-1111-1111-111111111111";
function row(p: Partial<StudentRow> = {}): StudentRow {
  return {
    ...blankStudentRow(coach),
    firstName: "Priya",
    lastName: "Okonkwo",
    email: "d@example.com",
    ...p,
  };
}
const ctx = (others: StudentRow[] = [], existing: string[] = []) => ({
  seated: new Set([coach]),
  existing: new Set(existing),
  others,
});

describe("club add students rules", () => {
  it("blocks coaches without a club seat", () => {
    const r = row();
    expect(studentRowProblems(r, { ...ctx(), seated: new Set() })).toContain(
      "This coach doesn't hold a club seat",
    );
  });
  it("needs a parent or guardian email for under-18 students", () => {
    expect(studentRowProblems(row({ email: "" }), ctx())).toContain(
      "Add a parent or guardian email",
    );
    expect(studentRowProblems(row({ email: "", adult: true }), ctx())).toContain(
      "Add the athlete's email",
    );
  });
  it("won't add the same student twice to a coach (safe retry)", () => {
    expect(studentRowProblems(row(), ctx([], [`${coach}|priya okonkwo`]))).toContain(
      "Already on this coach's roster",
    );
    const a = row();
    const b = row();
    expect(studentRowProblems(a, ctx([a, b]))).toContain("Listed twice");
  });
  it("accepts a complete row", () => {
    expect(studentRowProblems(row({ dayOfWeek: 1, start: "16:00" }), ctx())).toEqual([]);
  });
  it("reads pasted spreadsheet rows", () => {
    const rows = parsePastedStudents(
      "First\tLast\tEmail\nPriya\tOkonkwo\tD@Example.com\tUnder 18\tMon\t4:00 PM\t30",
      coach,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "d@example.com",
      dayOfWeek: 1,
      start: "16:00",
      lengthMinutes: 30,
      adult: false,
    });
    expect(normalizeStart("6am")).toBe("06:00");
  });
  it("reports invite status", () => {
    expect(clubInviteStatus({ joined: false, email: "", invitedAt: null })).toBe("Missing email");
    expect(clubInviteStatus({ joined: false, email: "a@b.co", invitedAt: null })).toBe(
      "Not invited",
    );
    expect(clubInviteStatus({ joined: true, email: null, invitedAt: null })).toBe("Joined");
  });
});
