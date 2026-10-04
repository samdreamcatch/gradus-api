import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ANALYTICS_AREAS,
  ANALYTICS_EVENTS,
  EVENT_PROPS,
  ageBand,
  analyticsBatchInput,
  cleanProps,
  recordAnalyticsBatch,
} from "./analytics.server";

const NOW = new Date("2026-09-23T12:00:00Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const batch = (over: Record<string, unknown> = {}) =>
  analyticsBatchInput.parse({
    platform: "ios",
    appVersion: "1.0.0 (12)",
    osVersion: "26.0",
    events: [
      {
        id: uuid(1),
        sessionId: uuid(99),
        occurredAt: "2026-09-23T11:00:00Z",
        event: "resource_open",
        area: "resources",
        screen: "resources.viewer",
        resourceId: uuid(50),
        props: { kind: "pdf", origin: "library", query: "should never be stored" },
      },
      {
        id: uuid(2),
        sessionId: uuid(99),
        occurredAt: "2026-09-23T11:05:00Z",
        event: "screen_time",
        area: "resources",
        screen: "resources.library",
        durationMs: 120000,
      },
    ],
    ...over,
  });

/**
 * A fake admin: tables answer from `rows`, RPCs from `rpcs`; records the
 * upserted rows.
 */
function fakeAdmin(rows: Record<string, unknown>, rpcs: Record<string, unknown[]> = {}) {
  const upserts: { rows: Record<string, unknown>[]; opts: unknown }[] = [];
  const from = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in"]) self[m] = () => self;
    const value = rows[table];
    self.maybeSingle = async () => ({
      data: Array.isArray(value) ? null : (value ?? null),
      error: null,
    });
    self.upsert = async (r: Record<string, unknown>[], opts: unknown) => (
      upserts.push({ rows: r, opts }),
      { error: null }
    );
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: Array.isArray(value) ? value : [], error: null });
    return self;
  };
  const rpc = async (fn: string) => ({ data: rpcs[fn] ?? [], error: null });
  return { admin: { from, rpc }, upserts };
}

describe("the batch schema", () => {
  it("allows only listed events, areas and plain screen ids; caps size and duration", () => {
    expect(batch().events).toHaveLength(2);
    const bad = (e: Record<string, unknown>) =>
      analyticsBatchInput.safeParse({
        platform: "ios",
        appVersion: "1",
        osVersion: "1",
        events: [
          {
            id: uuid(1),
            sessionId: uuid(2),
            occurredAt: "2026-09-23T11:00:00Z",
            event: "screen_time",
            area: "plans",
            screen: "plans",
            ...e,
          },
        ],
      }).success;
    expect(bad({})).toBe(true);
    expect(bad({ event: "page_view" })).toBe(false);
    expect(bad({ area: "billing" })).toBe(false);
    expect(bad({ screen: "Greta's plan" })).toBe(false);
    expect(bad({ durationMs: 31 * 60 * 1000 })).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => ({
      id: uuid(i + 1),
      sessionId: uuid(999),
      occurredAt: "2026-09-23T11:00:00Z",
      event: "screen_time",
      area: "plans",
      screen: "plans",
    }));
    expect(
      analyticsBatchInput.safeParse({
        platform: "ios",
        appVersion: "1",
        osVersion: "1",
        events: many,
      }).success,
    ).toBe(false);
  });

  it("drops props an event doesn't allow, never free text", () => {
    expect(
      cleanProps("resource_open", { kind: "pdf", origin: "library", query: "flip entry" }),
    ).toEqual({
      kind: "pdf",
      origin: "library",
    });
    expect(cleanProps("library_search", { resultCount: 3, text: "abuse" })).toEqual({
      resultCount: 3,
    });
    expect(cleanProps("screen_time", { anything: 1 })).toEqual({});
    expect(cleanProps("resource_read", { depth: 2 })).toEqual({});
  });
});

describe("ageBand", () => {
  it("bands by birthday, and a missing birthdate is unknown", () => {
    expect(ageBand("2016-01-01", NOW)).toBe("under_13");
    expect(ageBand("2012-09-23", NOW)).toBe("13_15");
    expect(ageBand("2009-09-24", NOW)).toBe("16_17");
    expect(ageBand("2008-09-23", NOW)).toBe("18_plus");
    expect(ageBand(null, NOW)).toBe("unknown");
    expect(ageBand("not a date", NOW)).toBe("unknown");
  });
});

describe("recordAnalyticsBatch", () => {
  it("stores an adult's events with their user id and role, idempotently", async () => {
    const { admin, upserts } = fakeAdmin({ coach_profiles: { id: "c1", onboarded_at: "t" } });
    const r = await recordAnalyticsBatch(admin, "user-1", batch(), NOW);
    expect(r).toEqual({ accepted: 2 });
    expect(upserts[0].opts).toEqual({ onConflict: "id", ignoreDuplicates: true });
    expect(upserts[0].rows[0]).toMatchObject({
      id: uuid(1),
      user_id: "user-1",
      subject: "adult",
      role: "coach",
      age_band: null,
      org_ids: [],
      regions: [],
      props: { kind: "pdf", origin: "library" },
    });
  });

  const minorWorld = (birthdate: string | null) =>
    fakeAdmin(
      {
        athletes: { id: "a1", birthdate },
        coach_athletes: [{ coach_id: "c1" }, { coach_id: "c2" }, { coach_id: "c3" }],
        coach_profiles: [
          { organization_id: "org-big" },
          { organization_id: "org-small" },
          { organization_id: null },
        ],
        organizations: [
          { id: "org-big", region: "Colorado" },
          { id: "org-small", region: "Wyoming" },
        ],
      },
      {
        analytics_org_minor_counts: [
          { org_id: "org-big", minors: 14 },
          { org_id: "org-small", minors: 3 },
        ],
        analytics_region_minor_counts: [
          { region: "Colorado", minors: 40 },
          { region: "Wyoming", minors: 6 },
        ],
      },
    );

  it("stores a minor with no user id and no coach id, only big-enough clubs and regions", async () => {
    const { admin, upserts } = minorWorld("2013-05-01");
    await recordAnalyticsBatch(admin, "user-kid", batch(), NOW);
    const row = upserts[0].rows[0];
    expect(row).toMatchObject({
      user_id: null,
      subject: "minor_athlete",
      role: "athlete",
      age_band: "13_15",
      org_ids: ["org-big"],
      regions: ["Colorado"],
      has_club: true,
    });
    const text = JSON.stringify(upserts[0].rows);
    for (const id of ["user-kid", "a1", "c1", "c2", "c3", "org-small", "Wyoming"]) {
      expect(text).not.toContain(id);
    }
  });

  it("judges an account with an athlete record as an athlete, even if it also has a coach profile", async () => {
    const { admin, upserts } = fakeAdmin(
      {
        athletes: { id: "a1", birthdate: "2014-02-02" },
        coach_profiles: { id: "c9", onboarded_at: "2026-01-01" },
      },
      {},
    );
    await recordAnalyticsBatch(admin, "user-kid", batch(), NOW);
    expect(upserts[0].rows[0]).toMatchObject({
      user_id: null,
      subject: "minor_athlete",
      role: "athlete",
    });
  });

  it("refuses free text in the sport prop and version strings", () => {
    expect(cleanProps("resource_open", { sport: "Greta's secret" })).toEqual({});
    expect(cleanProps("resource_open", { sport: "figure_skating" })).toEqual({
      sport: "figure_skating",
    });
    expect(
      analyticsBatchInput.safeParse({
        platform: "ios",
        appVersion: "hello <script>",
        osVersion: "26.0",
        events: batch().events,
      }).success,
    ).toBe(false);
  });

  it("treats an athlete with no birthdate on file as a minor", async () => {
    const { admin, upserts } = minorWorld(null);
    await recordAnalyticsBatch(admin, "user-kid", batch(), NOW);
    expect(upserts[0].rows[0]).toMatchObject({
      user_id: null,
      subject: "minor_athlete",
      age_band: "unknown",
    });
  });

  it("stores a confirmed adult athlete as an adult", async () => {
    const { admin, upserts } = minorWorld("1990-01-01");
    await recordAnalyticsBatch(admin, "user-adult", batch(), NOW);
    expect(upserts[0].rows[0]).toMatchObject({
      user_id: "user-adult",
      subject: "adult",
      age_band: "18_plus",
      org_ids: [],
    });
  });
});

describe("the contract vector", () => {
  it("matches the allow-list (run scripts/export-analytics-vector.ts after changing it)", () => {
    const vector = JSON.parse(readFileSync("docs/api/vectors/analytics-events.json", "utf8"));
    const areas = vector.cases.find((c: { name: string }) => c.name === "areas");
    expect(areas.expected).toEqual([...ANALYTICS_AREAS]);
    for (const event of ANALYTICS_EVENTS) {
      const c = vector.cases.find((x: { name: string }) => x.name === event);
      expect(c?.expected.props).toEqual(Object.keys(EVENT_PROPS[event].shape).sort());
    }
  });
});
