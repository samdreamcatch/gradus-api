import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  dismissCoachPostEvent,
  generatePlanFromResults,
  getAthleteCompetitionResults,
  getCoachPostEventItems,
  linkAthleteToSkater,
  listCoachRosterForCompetition,
  listFinishedCompetitions,
  unlinkAthleteCompetition,
} from "./competition-results.server";

/* -------------------------------------------------------------------------- */
/* A small, stateful, in-memory Supabase-shaped fake — enough of              */
/* `.select/.eq/.in/.is/.neq/.lt/.order/.limit` plus                          */
/* `.insert/.upsert/.update/.delete` and `.maybeSingle/.single`/bare-await    */
/* to exercise this file's real query shapes. Test-only.                     */
/* -------------------------------------------------------------------------- */

type Row = Record<string, any>;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `row_${idCounter}`;
}

function fakeAdmin(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const inserted: Record<string, Row[]> = {};

  function builder(
    table: string,
    filters: Array<(r: Row) => boolean>,
    mode: "select" | "insert" | "upsert" | "update" | "delete",
    payload: Row | Row[] | null,
    onConflict: string | undefined,
    order: Array<{ col: string; asc: boolean }>,
    limitN?: number,
  ): any {
    function execute(): Row[] {
      tables[table] ??= [];
      if (mode === "insert") {
        const arr = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({
          id: nextId(),
          ...r,
        }));
        tables[table].push(...arr);
        (inserted[table] ??= []).push(...arr);
        return arr;
      }
      if (mode === "upsert") {
        const arr = Array.isArray(payload) ? payload : [payload!];
        const keys = (onConflict ?? "id").split(",");
        const out: Row[] = [];
        for (const r of arr) {
          const idx = tables[table].findIndex((ex) => keys.every((k) => ex[k] === r[k]));
          if (idx >= 0) {
            tables[table][idx] = { ...tables[table][idx], ...r };
            out.push(tables[table][idx]);
          } else {
            const row = { id: nextId(), ...r };
            tables[table].push(row);
            out.push(row);
          }
        }
        (inserted[table] ??= []).push(...arr);
        return out;
      }
      if (mode === "update") {
        const rows = tables[table].filter((r) => filters.every((f) => f(r)));
        for (const r of rows) Object.assign(r, payload);
        return rows;
      }
      if (mode === "delete") {
        const rows = tables[table].filter((r) => filters.every((f) => f(r)));
        tables[table] = tables[table].filter((r) => !filters.every((f) => f(r)));
        return rows;
      }
      let rows = tables[table].filter((r) => filters.every((f) => f(r)));
      for (const o of order) {
        rows = [...rows].sort((a, b) => {
          const av = a[o.col];
          const bv = b[o.col];
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (o.asc ? 1 : -1);
        });
      }
      if (limitN != null) rows = rows.slice(0, limitN);
      return rows;
    }

    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) =>
        builder(table, [...filters, (r) => r[c] === v], mode, payload, onConflict, order, limitN),
      neq: (c: string, v: unknown) =>
        builder(table, [...filters, (r) => r[c] !== v], mode, payload, onConflict, order, limitN),
      in: (c: string, vs: unknown[]) =>
        builder(
          table,
          [...filters, (r) => vs.includes(r[c])],
          mode,
          payload,
          onConflict,
          order,
          limitN,
        ),
      is: (c: string, v: null) =>
        builder(
          table,
          [...filters, (r) => (r[c] ?? null) === v],
          mode,
          payload,
          onConflict,
          order,
          limitN,
        ),
      lt: (c: string, v: any) =>
        builder(table, [...filters, (r) => r[c] < v], mode, payload, onConflict, order, limitN),
      order: (c: string, o?: { ascending?: boolean }) =>
        builder(table, filters, mode, payload, onConflict, [
          ...order,
          { col: c, asc: o?.ascending !== false },
        ], limitN),
      limit: (n: number) => builder(table, filters, mode, payload, onConflict, order, n),
      insert: (row: Row | Row[]) =>
        builder(table, filters, "insert", row, onConflict, order, limitN),
      upsert: (row: Row | Row[], opts?: { onConflict?: string }) =>
        builder(table, filters, "upsert", row, opts?.onConflict, order, limitN),
      update: (patch: Row) => builder(table, filters, "update", patch, onConflict, order, limitN),
      delete: () => builder(table, filters, "delete", null, onConflict, order, limitN),
      maybeSingle: async () => ({ data: execute()[0] ?? null, error: null }),
      single: async () => ({ data: execute()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown, reject?: unknown) =>
        Promise.resolve({ data: execute(), error: null }).then(resolve, reject as never),
    };
    return api;
  }

  return { admin: { from: (table: string) => builder(table, [], "select", null, undefined, []) }, inserted, tables };
}

const COACH = { id: "co1", user_id: "coach-u" };
const ATHLETE = { id: "a1", first_name: "Ava", last_name: "Lee" };
const ROSTER = { coach_id: COACH.id, athlete_id: ATHLETE.id };

describe("listFinishedCompetitions", () => {
  it("refuses a non-coach and a coach without this athlete rostered", async () => {
    const { admin } = fakeAdmin({ coach_profiles: [], coach_athletes: [], competitions: [] });
    await expect(
      listFinishedCompetitions(admin, "nobody", { athleteId: ATHLETE.id }),
    ).rejects.toMatchObject({ code: "wrong_role", status: 403 });

    const { admin: admin2 } = fakeAdmin({
      coach_profiles: [COACH],
      coach_athletes: [],
      competitions: [],
    });
    await expect(
      listFinishedCompetitions(admin2, COACH.user_id, { athleteId: ATHLETE.id }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("returns only competitions that have ended, newest first", async () => {
    const { admin } = fakeAdmin({
      coach_profiles: [COACH],
      coach_athletes: [ROSTER],
      competitions: [
        { id: "c-past-1", name: "Early Bird", dates_label: "Jan", location: "A", ends_on: "2020-01-01" },
        { id: "c-past-2", name: "Regionals", dates_label: "Feb", location: "B", ends_on: "2020-02-01" },
        { id: "c-future", name: "Nationals", dates_label: "Dec", location: "C", ends_on: "2999-01-01" },
      ],
    });
    const out = await listFinishedCompetitions(admin, COACH.user_id, { athleteId: ATHLETE.id });
    expect(out.map((c) => c.id)).toEqual(["c-past-2", "c-past-1"]);
  });
});

describe("linkAthleteToSkater / unlinkAthleteCompetition / getAthleteCompetitionResults", () => {
  const COMP = {
    id: "comp1",
    name: "Demo Classic",
    dates_label: "Mar 1-3",
    location: "Rink",
    ijs_base_url: "https://example.invalid/comp",
    year: 2024,
    ends_on: "2024-03-03",
  };

  it("links a demo skater without hitting the network, then unlinks cleanly", async () => {
    const { admin } = fakeAdmin({
      coach_profiles: [COACH],
      coach_athletes: [ROSTER],
      athletes: [ATHLETE],
      competitions: [COMP],
      athlete_competition_skaters: [],
      athlete_competition_results: [],
      plans: [],
    });

    const linked = await linkAthleteToSkater(admin, COACH.user_id, {
      athleteId: ATHLETE.id,
      competitionId: COMP.id,
      skaterName: "Jamie Gilmore",
      club: "Ice Club",
      files: ["d1.html", "d2.html"],
    });
    expect(linked).toEqual({ linked: 2 });

    const results = await getAthleteCompetitionResults(admin, COACH.user_id, {
      athleteId: ATHLETE.id,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.skaterName).toBe("Jamie Gilmore");
    expect(results[0]!.results).toHaveLength(2);
    expect(results[0]!.existingPlan).toBeNull();

    const unlinked = await unlinkAthleteCompetition(admin, COACH.user_id, {
      athleteId: ATHLETE.id,
      competitionId: COMP.id,
    });
    expect(unlinked).toEqual({ ok: true });

    const after = await getAthleteCompetitionResults(admin, COACH.user_id, {
      athleteId: ATHLETE.id,
    });
    expect(after).toEqual([]);
  });

  it("surfaces an already-drafted plan alongside the results", async () => {
    const { admin } = fakeAdmin({
      coach_profiles: [COACH],
      coach_athletes: [ROSTER],
      athletes: [ATHLETE],
      competitions: [COMP],
      athlete_competition_skaters: [
        { athlete_id: ATHLETE.id, competition_id: COMP.id, skater_name: "Jamie Gilmore", club: "" },
      ],
      athlete_competition_results: [
        {
          id: "r1",
          athlete_id: ATHLETE.id,
          competition_id: COMP.id,
          event_name: "Free Skate",
          segment: "Free",
          rink: "A",
          placement: "2",
          segment_score: "80",
          total_score: "130",
          protocol: null,
        },
      ],
      plans: [
        {
          id: "plan1",
          coach_id: COACH.id,
          athlete_id: ATHLETE.id,
          title: "Post-comp plan",
          status: "active",
          source_competition_id: COMP.id,
          created_at: "2024-03-05T00:00:00Z",
        },
      ],
    });

    const results = await getAthleteCompetitionResults(admin, COACH.user_id, {
      athleteId: ATHLETE.id,
    });
    expect(results[0]!.existingPlan).toEqual({ id: "plan1", title: "Post-comp plan", status: "active" });
  });
});

describe("getCoachPostEventItems / dismissCoachPostEvent", () => {
  it("lists a linked athlete only until the coach activates a plan drafted from that event", async () => {
    const now = new Date();
    const endsOn = new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
    const COMP = { id: "comp1", name: "Winter Classic", dates_label: "", ends_on: endsOn };

    const { admin } = fakeAdmin({
      coach_profiles: [COACH],
      coach_athletes: [ROSTER],
      athletes: [ATHLETE],
      competition_attendance: [
        {
          user_id: COACH.user_id,
          competition_id: COMP.id,
          viewer_role: "coach",
          first_seen_at: now.toISOString(),
          dismissed_at: null,
        },
      ],
      competitions: [COMP],
      athlete_competition_skaters: [
        { athlete_id: ATHLETE.id, competition_id: COMP.id, skater_name: "Jamie" },
      ],
      athlete_competition_results: [
        {
          athlete_id: ATHLETE.id,
          competition_id: COMP.id,
          segment: "Free Skate",
          event_name: "Free Skate",
          placement: "2",
        },
      ],
      competition_recaps: [],
      plans: [],
    });

    const before = await getCoachPostEventItems(admin, COACH.user_id);
    expect(before).toHaveLength(1);
    expect(before[0]!.linked).toHaveLength(1);
    expect(before[0]!.linked[0]!.summary).toContain("Free Skate");

    // Activate a plan drafted from this competition — the athlete drops off the list.
    await admin.from("plans").insert({
      coach_id: COACH.id,
      athlete_id: ATHLETE.id,
      source: "competition",
      source_competition_id: COMP.id,
      status: "active",
    });
    const after = await getCoachPostEventItems(admin, COACH.user_id);
    expect(after).toEqual([]);
  });

  it("dismisses a competition so it stops being asked about", async () => {
    const { admin, tables } = fakeAdmin({
      coach_profiles: [COACH],
      competition_attendance: [
        { user_id: COACH.user_id, competition_id: "c1", dismissed_at: null },
      ],
    });
    await dismissCoachPostEvent(admin, COACH.user_id, { competitionId: "c1" });
    expect(tables.competition_attendance![0]!.dismissed_at).toBeTruthy();
  });
});

describe("listCoachRosterForCompetition", () => {
  it("keeps only figure-skating rostered athletes and flags who's already linked", async () => {
    const other = { id: "a2", first_name: "Bo", last_name: "Lee" };
    const { admin } = fakeAdmin({
      coach_profiles: [COACH],
      coach_athletes: [ROSTER, { coach_id: COACH.id, athlete_id: other.id }],
      athletes: [ATHLETE, other],
      coach_athlete_sports: [{ athlete_id: ATHLETE.id, sport: "figure_skating" }],
      athlete_competition_skaters: [
        { athlete_id: ATHLETE.id, competition_id: "c1", skater_name: "Jamie" },
      ],
    });
    const out = await listCoachRosterForCompetition(admin, COACH.user_id, { competitionId: "c1" });
    expect(out).toEqual([{ athleteId: ATHLETE.id, name: "Ava Lee", linked: true }]);
  });
});

describe("generatePlanFromResults", () => {
  it("refuses when there are no stored results yet", async () => {
    const { admin } = fakeAdmin({
      coach_profiles: [COACH],
      coach_athletes: [ROSTER],
      athlete_competition_results: [],
    });
    await expect(
      generatePlanFromResults(admin, COACH.user_id, { athleteId: ATHLETE.id, competitionId: "c1" }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("answers ai_unavailable when there's no AI gateway key configured", async () => {
    const original = process.env["LOVABLE_API_KEY"];
    delete process.env["LOVABLE_API_KEY"];
    try {
      const { admin } = fakeAdmin({
        coach_profiles: [COACH],
        coach_athletes: [ROSTER],
        athletes: [ATHLETE],
        competitions: [
          { id: "c1", name: "Comp", dates_label: "", location: "", ijs_base_url: "", year: 2024, ends_on: "2024-01-01" },
        ],
        athlete_competition_results: [
          {
            id: "r1",
            athlete_id: ATHLETE.id,
            competition_id: "c1",
            event_name: "Free Skate",
            segment: "Free",
            rink: "A",
            placement: "1",
            segment_score: "80",
            total_score: "130",
            protocol: null,
          },
        ],
      });
      await expect(
        generatePlanFromResults(admin, COACH.user_id, { athleteId: ATHLETE.id, competitionId: "c1" }),
      ).rejects.toMatchObject({ code: "ai_unavailable", status: 503 });
    } finally {
      if (original !== undefined) process.env["LOVABLE_API_KEY"] = original;
    }
  });
});

describe("ApiError propagation", () => {
  it("is the actual error class the functions throw for gating failures", async () => {
    const { admin } = fakeAdmin({ coach_profiles: [], coach_athletes: [] });
    try {
      await listFinishedCompetitions(admin, "nobody", { athleteId: ATHLETE.id });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
    }
  });
});
