import { describe, expect, it } from "vitest";
import { groupRows, nextSort, parsePrefs, sortRows, visibleKeys } from "./club-grid";

type R = { name: string; n: number | null };
const rows: R[] = [
  { name: "b", n: 2 },
  { name: "a", n: null },
  { name: "c", n: 10 },
];
const val = (r: R, k: string) => (k === "n" ? r.n : r.name);

describe("club grid", () => {
  it("sorts numbers numerically and keeps blanks last in both directions", () => {
    expect(sortRows(rows, { key: "n", dir: "asc" }, val).map((r) => r.name)).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, { key: "n", dir: "desc" }, val).map((r) => r.name)).toEqual(["c", "b", "a"]);
  });

  it("leaves order alone with no sort", () => {
    expect(sortRows(rows, null, val)).toBe(rows);
  });

  it("groups in order and puts blanks under None at the end", () => {
    const g = groupRows([{ s: "" }, { s: "Tennis" }, { s: "Skating" }, { s: "Tennis" }], (r) => r.s);
    expect(g.map((x) => [x.label, x.rows.length])).toEqual([
      ["Tennis", 2],
      ["Skating", 1],
      ["None", 1],
    ]);
  });

  it("never hides the first column", () => {
    expect(visibleKeys(["name", "email", "joined"], ["name", "email"])).toEqual(["name", "joined"]);
  });

  it("cycles header sort asc, desc, off", () => {
    const a = nextSort(null, "n");
    const d = nextSort(a, "n");
    expect(a).toEqual({ key: "n", dir: "asc" });
    expect(d).toEqual({ key: "n", dir: "desc" });
    expect(nextSort(d, "n")).toBeNull();
  });

  it("drops saved settings for columns that no longer exist", () => {
    const p = parsePrefs(
      JSON.stringify({ hidden: ["gone", "email"], sort: { key: "gone", dir: "asc" }, group: "sport" }),
      ["name", "email"],
      [],
    );
    expect(p).toEqual({ hidden: ["email"], sort: null, group: null });
  });
});
