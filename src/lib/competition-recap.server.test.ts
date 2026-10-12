import { describe, expect, it } from "bun:test";
import { exportPKCS8, generateKeyPair } from "jose";
import { resetApnsTokenCache } from "./apns.server";
import {
  dismissCompetitionRecap,
  getAthleteCompetitionRecaps,
  getPendingCompetitionRecap,
  getRecapCoaches,
  submitCompetitionRecap,
} from "./competition-recap.server";

/* -------------------------------------------------------------------------- */
/* Same small, stateful, in-memory Supabase-shaped fake as                    */
/* competition-results.server.test.ts — see that file for the rationale.      */
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
        builder(
          table,
          filters,
          mode,
          payload,
          onConflict,
          [...order, { col: c, asc: o?.ascending !== false }],
          limitN,
        ),
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

  return {
    admin: { from: (table: string) => builder(table, [], "select", null, undefined, []) },
    inserted,
    tables,
  };
}

const PARENT = { id: "p1", user_id: "parent-u", first_name: "Corin", last_name: "Abbott" };
const ATHLETE = {
  id: "a1",
  parent_id: PARENT.id,
  user_id: "athlete-u",
  first_name: "Maeve",
  last_name: "Abbott",
};
const COACH = { id: "co1", user_id: "coach-u", first_name: "Coach", last_name: "K" };

describe("getPendingCompetitionRecap", () => {
  it("returns null for a caller with no parent/athlete profile", async () => {
    const { admin } = fakeAdmin({ parent_profiles: [], athletes: [] });
    expect(await getPendingCompetitionRecap(admin, "nobody")).toBeNull();
  });

  it("skips a competition that hasn't finished yet, and resolves the lone candidate athlete", async () => {
    const now = new Date();
    const running = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
    const finished = new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);

    const { admin } = fakeAdmin({
      parent_profiles: [PARENT],
      athletes: [ATHLETE],
      athlete_guardians: [],
      coach_athlete_sports: [{ athlete_id: ATHLETE.id, sport: "figure_skating" }],
      competition_attendance: [
        {
          user_id: PARENT.user_id,
          competition_id: "still-running",
          athlete_id: null,
          first_seen_at: now.toISOString(),
          dismissed_at: null,
          recap_done_at: null,
        },
        {
          user_id: PARENT.user_id,
          competition_id: "finished",
          athlete_id: null,
          first_seen_at: now.toISOString(),
          dismissed_at: null,
          recap_done_at: null,
        },
      ],
      competitions: [
        { id: "still-running", name: "Live Now", dates_label: "", ends_on: running },
        { id: "finished", name: "Wrapped Up", dates_label: "", ends_on: finished },
      ],
    });

    const pending = await getPendingCompetitionRecap(admin, PARENT.user_id);
    expect(pending?.competitionId).toBe("finished");
    expect(pending?.athleteId).toBe(ATHLETE.id);
    expect(pending?.athleteChoices).toEqual([]);
  });
});

describe("dismissCompetitionRecap", () => {
  it("marks the attendance row dismissed", async () => {
    const { admin, tables } = fakeAdmin({
      competition_attendance: [
        { user_id: PARENT.user_id, competition_id: "c1", dismissed_at: null },
      ],
    });
    await dismissCompetitionRecap(admin, PARENT.user_id, { competitionId: "c1" });
    expect(tables.competition_attendance![0]!.dismissed_at).toBeTruthy();
  });
});

describe("getRecapCoaches", () => {
  it("refuses an athlete that isn't the caller's", async () => {
    const other = { id: "a2", parent_id: "someone-else" };
    const { admin } = fakeAdmin({
      parent_profiles: [PARENT],
      athletes: [ATHLETE, other],
      athlete_guardians: [],
      coach_athlete_sports: [],
    });
    await expect(
      getRecapCoaches(admin, PARENT.user_id, { athleteId: other.id }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("lists the athlete's rostered coaches", async () => {
    const { admin } = fakeAdmin({
      parent_profiles: [PARENT],
      athletes: [ATHLETE],
      athlete_guardians: [],
      coach_athlete_sports: [{ athlete_id: ATHLETE.id, sport: "figure_skating" }],
      coach_athletes: [{ coach_id: COACH.id, athlete_id: ATHLETE.id }],
      coach_profiles: [COACH],
    });
    const out = await getRecapCoaches(admin, PARENT.user_id, { athleteId: ATHLETE.id });
    expect(out).toEqual([{ id: COACH.id, name: "Coach K" }]);
  });
});

describe("submitCompetitionRecap", () => {
  const base = {
    parent_profiles: [PARENT],
    athletes: [ATHLETE],
    athlete_guardians: [],
    coach_athlete_sports: [{ athlete_id: ATHLETE.id, sport: "figure_skating" }],
    coach_athletes: [{ coach_id: COACH.id, athlete_id: ATHLETE.id }],
    competitions: [{ id: "c1", name: "Regionals" }],
    competition_attendance: [{ user_id: PARENT.user_id, competition_id: "c1" }],
    message_rooms: [],
    messages: [],
    competition_recaps: [],
  };

  it("refuses a caller with no parent/athlete profile", async () => {
    const { admin } = fakeAdmin({ parent_profiles: [], athletes: [] });
    await expect(
      submitCompetitionRecap(admin, "nobody", {
        competitionId: "c1",
        athleteId: ATHLETE.id,
        body: "Great meet!",
      }),
    ).rejects.toMatchObject({ code: "wrong_role", status: 403 });
  });

  it("404s for an unknown competition", async () => {
    const { admin } = fakeAdmin({ ...base, competitions: [] });
    await expect(
      submitCompetitionRecap(admin, PARENT.user_id, {
        competitionId: "missing",
        athleteId: ATHLETE.id,
        body: "Great meet!",
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("stores the recap, marks the attendance row done, and posts into a new room per rostered coach", async () => {
    const { admin, tables } = fakeAdmin(base);
    const result = await submitCompetitionRecap(admin, PARENT.user_id, {
      competitionId: "c1",
      athleteId: ATHLETE.id,
      body: "Skated the best free program of the season!",
    });
    expect(result).toEqual({ ok: true });
    expect(tables.competition_recaps).toHaveLength(1);
    expect(tables.competition_recaps![0]!.author_role).toBe("parent");
    expect(tables.competition_attendance![0]!.recap_done_at).toBeTruthy();
    expect(tables.message_rooms).toHaveLength(1);
    expect(tables.message_rooms![0]!.coach_id).toBe(COACH.id);
    expect(tables.messages).toHaveLength(1);
    expect(tables.messages![0]!.body).toContain("Regionals");
    expect(tables.messages![0]!.body).toContain("Skated the best free program");
  });

  it("only messages the selected coaches when coachIds is given", async () => {
    const otherCoach = { id: "co2", user_id: "coach2-u" };
    const { admin, tables } = fakeAdmin({
      ...base,
      coach_athletes: [
        { coach_id: COACH.id, athlete_id: ATHLETE.id },
        { coach_id: otherCoach.id, athlete_id: ATHLETE.id },
      ],
    });
    await submitCompetitionRecap(admin, PARENT.user_id, {
      competitionId: "c1",
      athleteId: ATHLETE.id,
      body: "Recap",
      coachIds: [COACH.id],
    });
    expect(tables.message_rooms).toHaveLength(1);
    expect(tables.message_rooms![0]!.coach_id).toBe(COACH.id);
  });
});

describe("submitCompetitionRecap push (decision #54)", () => {
  it("pushes the coach a message they can reply to, addressed to their own account", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const env = {
      APPLE_TEAM_ID: "TEAMID1234",
      APNS_KEY_ID: "KEYID12345",
      APNS_KEY_P8: await exportPKCS8(privateKey),
    };
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    const realFetch = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    Object.assign(process.env, env);
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200, headers: { "apns-id": "x" } });
    }) as unknown as typeof fetch;
    resetApnsTokenCache();
    try {
      const { admin, tables } = fakeAdmin({
        parent_profiles: [PARENT],
        athletes: [ATHLETE],
        athlete_guardians: [],
        coach_profiles: [COACH],
        coach_athlete_sports: [{ athlete_id: ATHLETE.id, sport: "figure_skating" }],
        coach_athletes: [{ coach_id: COACH.id, athlete_id: ATHLETE.id }],
        competitions: [{ id: "c1", name: "Regionals" }],
        competition_attendance: [{ user_id: PARENT.user_id, competition_id: "c1" }],
        message_rooms: [],
        messages: [],
        competition_recaps: [],
        device_tokens: [{ user_id: COACH.user_id, token: "tok-coach", platform: "ios" }],
      });
      await submitCompetitionRecap(admin, PARENT.user_id, {
        competitionId: "c1",
        athleteId: ATHLETE.id,
        body: "Clean program!",
      });
      const roomId = tables.message_rooms![0]!.id as string;
      expect(bodies).toHaveLength(1);
      expect(bodies[0]!.aps).toMatchObject({
        alert: { title: "Competition recap" },
        "thread-id": `room:${roomId}`,
        category: "GRADUS_MESSAGE",
      });
      expect(bodies[0]!.gradus).toEqual({
        type: "message",
        route: `rooms/${roomId}`,
        v: 1,
        uid: COACH.user_id,
      });
    } finally {
      globalThis.fetch = realFetch;
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetApnsTokenCache();
    }
  });
});

describe("getAthleteCompetitionRecaps", () => {
  it("lets the athlete themself read their own recaps", async () => {
    const { admin } = fakeAdmin({
      coach_profiles: [],
      parent_profiles: [],
      athlete_guardians: [],
      athletes: [ATHLETE],
      competition_recaps: [
        {
          id: "rec1",
          competition_id: "c1",
          athlete_id: ATHLETE.id,
          body: "Great day",
          author_role: "athlete",
          author_user_id: ATHLETE.user_id,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
      competitions: [{ id: "c1", name: "Regionals" }],
    });
    const out = await getAthleteCompetitionRecaps(admin, ATHLETE.user_id, {
      athleteId: ATHLETE.id,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.competitionName).toBe("Regionals");
  });

  it("returns nothing for a caller outside the athlete's circle", async () => {
    const { admin } = fakeAdmin({
      coach_profiles: [],
      parent_profiles: [],
      athlete_guardians: [],
      athletes: [ATHLETE],
      competition_recaps: [
        {
          id: "rec1",
          competition_id: "c1",
          athlete_id: ATHLETE.id,
          body: "Great day",
          author_role: "athlete",
          author_user_id: ATHLETE.user_id,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    expect(
      await getAthleteCompetitionRecaps(admin, "stranger-u", { athleteId: ATHLETE.id }),
    ).toEqual([]);
  });

  const CO_PARENT = { id: "p2", user_id: "co-parent-u", first_name: "Cam", last_name: "G" };
  const CO_LINK = { id: "g1", athlete_id: ATHLETE.id, parent_id: CO_PARENT.id, role: "co" };
  const recap = {
    id: "rec1",
    competition_id: "c1",
    athlete_id: ATHLETE.id,
    body: "Great day",
    author_role: "athlete",
    author_user_id: ATHLETE.user_id,
    created_at: "2024-01-01T00:00:00Z",
  };

  it("a co-guardian reads recaps while the primary's Team plan is active", async () => {
    const { admin } = fakeAdmin({
      coach_profiles: [],
      parent_profiles: [
        { ...PARENT, subscription_status: "active", current_period_end: null },
        CO_PARENT,
      ],
      athlete_guardians: [CO_LINK],
      athletes: [ATHLETE],
      competition_recaps: [recap],
      competitions: [{ id: "c1", name: "Regionals" }],
    });
    const out = await getAthleteCompetitionRecaps(admin, CO_PARENT.user_id, {
      athleteId: ATHLETE.id,
    });
    expect(out).toHaveLength(1);
  });

  it("a co-guardian gets nothing once the primary's Team plan has lapsed", async () => {
    const { admin } = fakeAdmin({
      coach_profiles: [],
      parent_profiles: [
        { ...PARENT, subscription_status: null, current_period_end: null },
        CO_PARENT,
      ],
      athlete_guardians: [CO_LINK],
      athletes: [ATHLETE],
      competition_recaps: [recap],
      competitions: [{ id: "c1", name: "Regionals" }],
    });
    expect(
      await getAthleteCompetitionRecaps(admin, CO_PARENT.user_id, { athleteId: ATHLETE.id }),
    ).toEqual([]);
  });
});
