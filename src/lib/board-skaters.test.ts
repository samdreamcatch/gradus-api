import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { BoardEvent, BoardPayload, BoardSkater, SkaterProtocol } from "./board-types";
import { eventKey, scoreSelectionFor, skatesOf } from "./board-skaters";

type Vector = {
  cases: { input: { name: string; segment: string; rink: string }; expected: string }[];
};

describe("eventKey", () => {
  it("matches every shared vector (docs/api/vectors/event-key.json)", () => {
    const vectors = JSON.parse(readFileSync("docs/api/vectors/event-key.json", "utf8")) as Vector;
    expect(vectors.cases.length).toBeGreaterThan(0);
    for (const c of vectors.cases) {
      expect(eventKey(c.input.name, c.input.segment, c.input.rink)).toBe(c.expected);
    }
  });
});

const PROTO: SkaterProtocol = {
  total: "38.92",
  elementsScore: "21.41",
  componentsScore: "17.51",
  deductionsScore: "0.00",
  elements: [],
  elementsTotal: null,
  components: [],
  deductions: [],
};

function skater(start: number, name: string, over: Partial<BoardSkater> = {}): BoardSkater {
  return {
    start,
    of: 3,
    name,
    club: "Northwind SC",
    group: "",
    segScore: "",
    total: "",
    place: "",
    ...over,
  };
}

function event(
  file: string,
  segment: string,
  results: BoardSkater[],
  over: Partial<BoardEvent> = {},
): BoardEvent {
  return {
    file,
    name: "Juvenile Girls",
    segment,
    rink: "Main Rink",
    timeLabel: "9:00 AM",
    startIso: null,
    status: "final",
    count: 3,
    dayLabel: "Sat Oct 3",
    dayKey: "2026-10-03",
    results,
    ...over,
  };
}

/** Ada: short program (final, protocol no longer carried), free skate live on Main Rink, pairs later. */
function payload(): BoardPayload {
  return {
    generatedAt: "2026-10-03T17:10:00.000Z",
    competition: {
      name: "Fall Classic",
      dates: "10/3/2026",
      location: "",
      url: "https://ijs.usfigureskating.org/leaderboard/results/2026/37055/index.asp",
    },
    rinks: [
      {
        name: "Main Rink",
        state: "live",
        current: {
          event: "Juvenile Girls",
          segment: "Free Skate",
          status: "Live Unofficial",
          skaters: 3,
          withdrawn: 0,
          done: 1,
          startLabel: "1:00 PM",
          startIso: null,
          url: "",
          justScored: null,
          onIce: null,
          upNext: null,
          startOrder: [skater(1, "Ada Ruiz", { segScore: "38.92", place: "1", protocol: PROTO })],
        },
        next: null,
        justFinished: null,
        alsoLive: [],
        dayEvents: 2,
      },
    ],
    schedule: [
      event("SEGM001.htm", "Short Program", [
        skater(1, "Bea Lind", { segScore: "30.10" }),
        skater(2, "Ada Ruiz", { segScore: "31.25" }),
      ]),
      event("SEGM002.htm", "Free Skate", [skater(1, "Ada Ruiz", { segScore: "38.92" })], {
        status: "live",
      }),
      event("SEGM003.htm", "Free Skate", [skater(2, "ADA  Ruíz")], {
        name: "Juvenile Pairs",
        rink: "Rink 2",
        status: "scheduled",
      }),
    ],
    errors: [],
  };
}

describe("skatesOf / scoreSelectionFor", () => {
  const focus = eventKey("Juvenile Girls", "Free Skate", "Main Rink");

  it("lists every skate by name, the tapped event first, the rest in schedule order", () => {
    const p = payload();
    const tapped = p.rinks[0]!.current!.startOrder[0]!;
    const sel = scoreSelectionFor(p, tapped, focus);
    expect(sel.name).toBe("Ada Ruiz");
    expect(sel.club).toBe("Northwind SC");
    expect(sel.skates.map((s) => s.event.file)).toEqual([
      "SEGM002.htm",
      "SEGM001.htm",
      "SEGM003.htm",
    ]);
  });

  it("keeps the tapped copy's protocol when the schedule's row has none", () => {
    const p = payload();
    const tapped = p.rinks[0]!.current!.startOrder[0]!;
    expect(scoreSelectionFor(p, tapped, focus).skates[0]!.skater.protocol).toEqual(PROTO);
    const plain = skatesOf(payload(), "ada ruiz");
    expect(plain.find((s) => s.event.file === "SEGM002.htm")!.skater.protocol).toBeUndefined();
  });

  it("links each skate to its official results page, and finds nothing for a stranger", () => {
    const skates = skatesOf(payload(), "ada ruiz");
    expect(skates.map((s) => s.event.file)).toEqual(["SEGM001.htm", "SEGM002.htm", "SEGM003.htm"]);
    expect(skates[0]!.officialUrl).toBe(
      "https://ijs.usfigureskating.org/leaderboard/results/2026/37055/SEGM001.htm",
    );
    expect(skatesOf(payload(), "nobody here")).toEqual([]);
    expect(skatesOf(null, "ada ruiz")).toEqual([]);
  });

  it("opens the same thing from results as from the rink panel", () => {
    const p = payload();
    const fromWheel = scoreSelectionFor(p, p.rinks[0]!.current!.startOrder[0]!, focus);
    const row = p.schedule[1]!.results.find((r) => r.name === "Ada Ruiz")!;
    // The results row lacks the protocol; the board-wide rule still picks the same skates.
    expect(scoreSelectionFor(p, row, focus).skates.map((s) => s.event.file)).toEqual(
      fromWheel.skates.map((s) => s.event.file),
    );
  });
});
