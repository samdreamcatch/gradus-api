import { describe, expect, it } from "bun:test";
import { adultUsers, minorGroupRows, type GroupActivity, type RosterOrg } from "./analytics-report";

const act = (
  kind: GroupActivity["kind"],
  key: string,
  events: number,
  safeSport = 0,
): GroupActivity => ({
  kind,
  key,
  events,
  safeSportOpens: safeSport,
  resourceOpens: 0,
  screenMs: 0,
});

describe("adultUsers", () => {
  it("floors groups under 5", () => {
    expect(adultUsers(0)).toBe("0");
    expect(adultUsers(3)).toBe("<5");
    expect(adultUsers(5)).toBe("5");
  });
});

describe("minorGroupRows", () => {
  const roster: RosterOrg[] = [
    { orgId: "big", name: "Big Rink FSC", region: "Colorado", minors: 30 },
    { orgId: "mid", name: "Mid Club", region: "Colorado", minors: 12 },
    { orgId: "tiny", name: "Tiny Club", region: "Colorado", minors: 4 },
    { orgId: "far", name: "Far Club", region: "Wyoming", minors: 25 },
  ];
  const activity = [
    act("club", "big", 300, 30),
    act("club", "mid", 100, 3),
    act("club", "far", 80, 5),
    act("region", "Colorado", 420),
    act("region", "Wyoming", 80),
    act("bucket", "other_clubs", 20, 1),
    act("bucket", "no_club", 50, 2),
  ];

  it("names only clubs with 10+ minors and merges the rest", () => {
    const { clubs } = minorGroupRows(roster, activity, 40);
    expect(clubs.map((c) => c.label)).toEqual([
      "Big Rink FSC",
      "Mid Club",
      "Far Club",
      "Other clubs",
      "No club",
    ]);
    expect(clubs.find((c) => c.label === "Big Rink FSC")?.safeSportPerMinor).toBe(1);
    expect(JSON.stringify(clubs)).not.toContain("Tiny Club");
  });

  it("withholds a region whose unnamed remainder is 1-9 minors (no finding a small club by subtraction)", () => {
    const { regions } = minorGroupRows(roster, activity, 40);
    // Colorado: 46 minors, 42 in named clubs → 4 in Tiny Club → withheld.
    expect(regions.find((r) => r.label === "Colorado")).toMatchObject({
      withheld: true,
      events: 0,
      minors: null,
    });
    expect(regions.find((r) => r.label === "Wyoming")).toMatchObject({ minors: 25, events: 80 });
  });

  it("withholds Other clubs and No club when they cover 1-9 minors", () => {
    const { clubs } = minorGroupRows(roster, activity, 7);
    expect(clubs.find((c) => c.label === "Other clubs")).toMatchObject({ withheld: true });
    expect(clubs.find((c) => c.label === "No club")).toMatchObject({ withheld: true, events: 0 });
  });

  it("reports the median Safe Sport rate across named clubs as the baseline", () => {
    const { baseline } = minorGroupRows(roster, activity, 40);
    // big 1.0, mid 0.25, far 0.2 → median 0.25
    expect(baseline.medianSafeSportPerMinor).toBe(0.25);
  });
});
