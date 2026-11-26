import Papa from "papaparse";
import { SPORTS } from "./coach-sports";

export function readClubCsv(text: string): string[][] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length) throw new Error("Couldn't read this CSV. Check its quotes and columns.");
  return parsed.data.map((cells) => cells.map((cell) => cell.trim()));
}

export type CoachCsvRow = { email: string; sports: string; levels: string };
export function readCoachCsv(text: string): CoachCsvRow[] {
  const rows = readClubCsv(text);
  const header = rows[0]?.map((cell) => cell.toLowerCase());
  if (!header?.includes("email") || !header.includes("sports")) {
    throw new Error("Use column headings Email, Sports, and optionally Levels.");
  }
  return rows.slice(1).map((cells) => ({
    email: (cells[header.indexOf("email")] ?? "").toLowerCase(),
    sports: cells[header.indexOf("sports")] ?? "",
    levels: cells[header.indexOf("levels")] ?? "",
  }));
}

const normalize = (value: string) => value.trim().toLowerCase();
export function coachCsvDetails(row: CoachCsvRow, rows: CoachCsvRow[]) {
  const problems: string[] = [];
  const email = normalize(row.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push("Check the email");
  if (rows.filter((r) => normalize(r.email) === email).length > 1) problems.push("Email listed twice");
  const sports: string[] = [];
  for (const value of row.sports.split(";").filter((v) => v.trim())) {
    const sport = SPORTS.find((s) => normalize(s.key) === normalize(value) || normalize(s.label) === normalize(value));
    if (!sport) problems.push(`Unknown sport: ${value}`);
    else if (!sports.includes(sport.key)) sports.push(sport.key);
  }
  if (!sports.length) problems.push("Add a sport");
  const levels: { sport: string; levelKey: string }[] = [];
  for (const value of row.levels.split(";").filter((v) => v.trim())) {
    const [sportName, ...parts] = value.split(":");
    const levelName = parts.length ? parts.join(":") : sportName ?? "";
    const candidates = SPORTS.filter((s) => sports.includes(s.key) && (!parts.length || normalize(s.key) === normalize(sportName ?? "") || normalize(s.label) === normalize(sportName ?? "")))
      .flatMap((s) => s.levels.filter((l) => normalize(l.key) === normalize(levelName) || normalize(l.label) === normalize(levelName)).map((l) => ({ sport: s.key, levelKey: l.key })));
    if (candidates.length !== 1) problems.push(`Check level: ${value}`);
    else if (candidates[0]) levels.push(candidates[0]);
  }
  return { email, sports, levels, problems };
}