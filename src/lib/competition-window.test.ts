import { describe, expect, it } from "bun:test";
import type { BoardEvent, BoardPayload, BoardRink } from "./board-types";
import {
  addDays,
  canStillBeLive,
  competitionWindow,
  dayKeyIn,
  isWithinWindow,
  parseDateRange,
  settleBoardPayload,
  wantsRefresh,
} from "./competition-window";

// Production on 2026-10-03, 10:53 PM Eastern (already Oct 4 in UTC): the board
// list said these were all live.
const NOW = new Date("2026-10-04T02:53:22Z");
const TODAY = dayKeyIn(NOW); // venue-local

describe("parseDateRange", () => {
  it("reads one- and two-digit months and days", () => {
    expect(parseDateRange("9/11/2026 - 9/13/2026")).toEqual({
      startsOn: "2026-09-11",
      endsOn: "2026-09-13",
    });
    expect(parseDateRange("9/30/2026 - 10/4/2026")).toEqual({
      startsOn: "2026-09-30",
      endsOn: "2026-10-04",
    });
    expect(parseDateRange("09/04/2026 - 09/06/2026 (EDT)")).toEqual({
      startsOn: "2026-09-04",
      endsOn: "2026-09-06",
    });
  });

  it("is null when the label has no dates, and one date is a one-day event", () => {
    expect(parseDateRange("Sample day")).toEqual({ startsOn: null, endsOn: null });
    expect(parseDateRange("")).toEqual({ startsOn: null, endsOn: null });
    expect(parseDateRange("10/3/2026")).toEqual({ startsOn: "2026-10-03", endsOn: "2026-10-03" });
  });
});

describe("dayKeyIn", () => {
  it("is the venue's date, not UTC's", () => {
    expect(NOW.toISOString().slice(0, 10)).toBe("2026-10-04");
    expect(TODAY).toBe("2026-10-03");
    expect(dayKeyIn(NOW, "America/Los_Angeles")).toBe("2026-10-03");
    expect(dayKeyIn(NOW, "Not/AZone")).toBe("2026-10-03");
  });

  it("adds days across a month end", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });
});

describe("competitionWindow", () => {
  it("is not live once the published days are over (the reported boards)", () => {
    const chicagoland = competitionWindow({ datesLabel: "9/11/2026 - 9/13/2026" });
    const midAtlantic = competitionWindow({ datesLabel: "9/8/2026 - 9/11/2026" });
    const bostonOpen = competitionWindow({ datesLabel: "9/30/2026 - 10/4/2026" });
    expect(isWithinWindow(chicagoland, TODAY)).toBe(false);
    expect(isWithinWindow(midAtlantic, TODAY)).toBe(false);
    expect(isWithinWindow(bostonOpen, TODAY)).toBe(true);
  });

  it("prefers stored dates and falls back to the label", () => {
    expect(
      competitionWindow({ startsOn: "2026-09-04", endsOn: "2026-09-06", datesLabel: "junk" }),
    ).toEqual({ start: "2026-09-04", end: "2026-09-06" });
  });

  it("ignores an implausible published range and uses the schedule's days", () => {
    // Magic City on IJS: "02/06/2026 - 02/07/2027 (CST)".
    expect(competitionWindow({ datesLabel: "02/06/2026 - 02/07/2027 (CST)" })).toBeNull();
    expect(
      competitionWindow({
        datesLabel: "02/06/2026 - 02/07/2027 (CST)",
        schedule: [{ dayKey: "2026-02-07" }, { dayKey: "2026-02-06" }],
      }),
    ).toEqual({ start: "2026-02-06", end: "2026-02-07" });
  });

  it("widens to scheduled days outside the published ones", () => {
    // Middle Atlantic published 9/8–9/11 but scheduled events on 9/12.
    expect(
      competitionWindow({
        datesLabel: "9/8/2026 - 9/11/2026",
        schedule: [{ dayKey: "2026-09-08" }, { dayKey: "2026-09-12" }],
      }),
    ).toEqual({ start: "2026-09-08", end: "2026-09-12" });
  });

  it("is null when nothing is known, and never live then", () => {
    const w = competitionWindow({ datesLabel: "", schedule: [] });
    expect(w).toBeNull();
    expect(isWithinWindow(w, TODAY)).toBe(false);
  });
});

describe("wantsRefresh", () => {
  const w = { start: "2026-09-11", end: "2026-09-13" };
  it("refreshes from the day before through the day after", () => {
    expect(wantsRefresh(w, "2026-09-09", null)).toBe(false);
    expect(wantsRefresh(w, "2026-09-10", "2026-09-09")).toBe(true);
    expect(wantsRefresh(w, "2026-09-12", "2026-09-12")).toBe(true);
    expect(wantsRefresh(w, "2026-09-14", "2026-09-14")).toBe(true);
  });

  it("rebuilds a snapshot taken before the end once, then leaves it", () => {
    expect(wantsRefresh(w, "2026-10-03", "2026-09-13")).toBe(true);
    expect(wantsRefresh(w, "2026-10-03", "2026-09-15")).toBe(false);
  });

  it("always refreshes when the dates are unknown", () => {
    expect(wantsRefresh(null, "2026-10-03", "2026-10-03")).toBe(true);
  });
});

describe("canStillBeLive", () => {
  it("allows today, and a late session for a few hours past midnight", () => {
    const today = "2026-10-03";
    expect(canStillBeLive(new Date("2026-10-03T14:00:00Z"), today, NOW, today)).toBe(true);
    // Started 11 PM Eastern on Oct 2; at 1 AM on Oct 3 it may still be running.
    const late = new Date("2026-10-03T03:00:00Z");
    expect(canStillBeLive(late, "2026-10-02", new Date("2026-10-03T05:00:00Z"), today)).toBe(true);
    expect(canStillBeLive(late, "2026-10-02", NOW, today)).toBe(false);
    expect(canStillBeLive(new Date("2026-10-05T14:00:00Z"), "2026-10-05", NOW, today)).toBe(false);
  });
});

function event(over: Partial<BoardEvent>): BoardEvent {
  return {
    file: "SEGM001.htm",
    name: "Juvenile Girls",
    segment: "Free Skate",
    rink: "Rink 1",
    timeLabel: "9:00 AM",
    startIso: "2026-10-03T13:00:00Z",
    status: "live",
    count: 8,
    dayLabel: "Sat Oct 3",
    dayKey: "2026-10-03",
    results: [],
    ...over,
  };
}

function liveRink(startIso: string): BoardRink {
  return {
    name: "Rink 1",
    state: "live",
    current: {
      event: "Juvenile Girls",
      segment: "Free Skate",
      status: "Live Unofficial",
      skaters: 8,
      withdrawn: 0,
      done: 3,
      startLabel: "9:00 AM",
      startIso,
      url: "",
      justScored: null,
      onIce: null,
      upNext: null,
      startOrder: [],
    },
    next: null,
    justFinished: null,
    alsoLive: ["Pre-Juvenile Girls"],
    dayEvents: 4,
  };
}

function payload(schedule: BoardEvent[], rinks: BoardRink[]): BoardPayload {
  return {
    generatedAt: "2026-10-03T14:00:00Z",
    competition: { name: "X", dates: "", location: "", url: "", timeZone: "America/New_York" },
    rinks,
    schedule,
    errors: [],
  };
}

describe("settleBoardPayload", () => {
  it("leaves today's live event alone inside the window", () => {
    const p = payload([event({})], [liveRink("2026-10-03T13:00:00Z")]);
    const now = new Date("2026-10-03T15:00:00Z");
    expect(settleBoardPayload(p, { now, todayKey: "2026-10-03", inWindow: true })).toBe(p);
  });

  it("turns a live event from an earlier day into results", () => {
    const p = payload(
      [event({ dayKey: "2026-10-01", startIso: "2026-10-01T13:00:00Z" }), event({ file: "B" })],
      [],
    );
    const out = settleBoardPayload(p, {
      now: new Date("2026-10-03T15:00:00Z"),
      todayKey: "2026-10-03",
      inWindow: true,
    });
    expect(out.schedule.map((e) => e.status)).toEqual(["final", "live"]);
  });

  it("settles everything once the competition is over, rinks included", () => {
    // A snapshot frozen mid-event on the last day, served three weeks later.
    const p = payload(
      [event({ dayKey: "2026-09-13", startIso: "2026-09-13T13:00:00Z" })],
      [liveRink("2026-09-13T13:00:00Z")],
    );
    const out = settleBoardPayload(p, { now: NOW, todayKey: TODAY, inWindow: false });
    expect(out.schedule[0]!.status).toBe("final");
    expect(out.rinks[0]!.state).toBe("idle");
    expect(out.rinks[0]!.current).toBeNull();
    expect(out.rinks[0]!.alsoLive).toEqual([]);
    expect(out.rinks[0]!.justFinished).toEqual({
      event: "Juvenile Girls Free Skate",
      winner: null,
    });
  });

  it("never shows a live rink outside the window, even with today's date", () => {
    const p = payload([event({})], [liveRink("2026-10-03T13:00:00Z")]);
    const out = settleBoardPayload(p, {
      now: new Date("2026-10-03T15:00:00Z"),
      todayKey: "2026-10-03",
      inWindow: false,
    });
    expect(out.rinks[0]!.state).toBe("idle");
    expect(out.schedule[0]!.status).toBe("final");
  });
});
