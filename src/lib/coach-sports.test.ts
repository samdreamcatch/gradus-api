import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COACH_SPORTS_VECTOR } from "../../scripts/export-coach-sports";
import { SPORTS } from "./coach-sports";

describe("coach sports contract vector", () => {
  it("matches the source catalog (run `bun scripts/export-coach-sports.ts` after editing SPORTS)", () => {
    const file = fileURLToPath(
      new URL("../../docs/api/vectors/coach-sports.json", import.meta.url),
    );
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(COACH_SPORTS_VECTOR)));
  });

  it("keeps sport and level keys database-safe", () => {
    for (const sport of SPORTS) {
      expect(sport.key).toMatch(/^[a-z0-9_]+$/);
      for (const level of sport.levels) expect(level.key).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
