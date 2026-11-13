import { describe, expect, it } from "bun:test";
import { coachCsvDetails, readCoachCsv } from "./club-csv";
import { parsePastedStudents } from "./club-add-students";

describe("club CSV imports", () => {
  it("imports coach email, sports and optional level", () => {
    const rows = readCoachCsv('Email,Sports,Levels\nCOACH@example.com,Tennis;Golf,Tennis:NTRP 3.0');
    expect(coachCsvDetails(rows[0] ?? { email: "", sports: "", levels: "" }, rows)).toEqual({ email: "coach@example.com", sports: ["tennis", "golf"], levels: [{ sport: "tennis", levelKey: "ntrp_3_0" }], problems: [] });
  });
  it("accepts optional levels left blank", () => {
    const row = { email: "coach@example.com", sports: "Golf", levels: "" };
    expect(coachCsvDetails(row, [row]).problems).toEqual([]);
  });
  it("blocks duplicate emails", () => {
    const row = { email: "coach@example.com", sports: "Golf", levels: "" };
    expect(coachCsvDetails(row, [row, { ...row, email: "COACH@example.com" }]).problems).toContain("Email listed twice");
  });
  it("blocks unrecognized sports and levels", () => {
    const row = { email: "coach@example.com", sports: "Golf;Unknown", levels: "Golf:Unknown" };
    expect(coachCsvDetails(row, [row]).problems).toEqual(["Unknown sport: Unknown", "Check level: Golf:Unknown"]);
  });
  it("reads quoted student cells without shifting guardian contacts", () => {
    expect(parsePastedStudents('First,Last,Email,Age,Day,Start,Length,Guardian first,Guardian last\nAlex,"Rivera, Jr",parent@example.com,Under 18,Mon,16:00,30,Sam,Rivera', "coach")[0]).toMatchObject({ firstName: "Alex", lastName: "Rivera, Jr", email: "parent@example.com", guardianFirstName: "Sam", adult: false });
  });
  it("rejects coach files without required headings", () => {
    expect(() => readCoachCsv("Name,Email\nAlex,coach@example.com")).toThrow();
  });
});