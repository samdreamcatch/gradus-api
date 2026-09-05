import { describe, expect, it } from "bun:test";
import { buildDemoBoard } from "@/lib/board-demo";
import { boardPayloadSchema, boardSkaterSchema } from "./board-schema";

describe("boardPayloadSchema", () => {
  it("accepts the built-in demo board payload", () => {
    const demo = buildDemoBoard();
    expect(demo.payload).not.toBeNull();
    const parsed = boardPayloadSchema.parse(demo.payload);
    expect(parsed.rinks.length).toBe(demo.payload!.rinks.length);
    expect(parsed.schedule.length).toBe(demo.payload!.schedule.length);
  });

  it("accepts a skater with the optional fields absent and with them present", () => {
    const base = {
      start: 1,
      of: 12,
      name: "A Skater",
      club: "Club",
      group: "1",
      segScore: "50.00",
      total: "100.00",
      place: "1",
    };
    expect(boardSkaterSchema.parse(base)).toMatchObject(base);
    expect(
      boardSkaterSchema.parse({
        ...base,
        finalPlace: "2",
        segScores: [{ segment: "SP", score: "50.00", place: "1" }],
        protocol: null,
      }).finalPlace,
    ).toBe("2");
  });

  it("rejects a rink with an unknown state", () => {
    const demo = buildDemoBoard();
    const broken = JSON.parse(JSON.stringify(demo.payload)) as { rinks: { state: string }[] };
    broken.rinks[0]!.state = "paused";
    expect(() => boardPayloadSchema.parse(broken)).toThrow();
  });
});
