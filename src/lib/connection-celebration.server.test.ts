import { describe, expect, it } from "bun:test";
import type { ApiContext } from "./api/auth";
import {
  acknowledgeConnection,
  getPendingConnectionCelebrations,
  mergeAckLinkIds,
} from "./connection-celebration.server";

/* -------------------------------------------------------------------------- */
/* Same small, stateful, in-memory Supabase-shaped fake as                    */
/* competition-recap.server.test.ts, with two extensions: `.order()` sorts   */
/* by every ordered column at once (created_at, then id), and `failing`      */
/* makes every query on a table resolve with an error so the `.error`        */
/* checks can be exercised.                                                   */
/* -------------------------------------------------------------------------- */

type Row = Record<string, any>;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `row_${idCounter}`;
}

function fakeAdmin(seed: Record<string, Row[]>, failing: string[] = []) {
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
      if (order.length) {
        rows = [...rows].sort((a, b) => {
          for (const o of order) {
            const av = a[o.col];
            const bv = b[o.col];
            if (av === bv) continue;
            return (av < bv ? -1 : 1) * (o.asc ? 1 : -1);
          }
          return 0;
        });
      }
      if (limitN != null) rows = rows.slice(0, limitN);
      return rows;
    }

    const result = () =>
      failing.includes(table)
        ? { data: null, error: { message: `boom: ${table}` } }
        : { data: execute(), error: null };
    const one = () => {
      const r = result();
      return r.error ? r : { data: r.data![0] ?? null, error: null };
    };

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
      maybeSingle: async () => one(),
      single: async () => one(),
      then: (resolve: (v: unknown) => unknown, reject?: unknown) =>
        Promise.resolve(result()).then(resolve, reject as never),
    };
    return api;
  }

  const admin = {
    from: (table: string) => builder(table, [], "select", null, undefined, []),
  } as unknown as ApiContext["admin"];
  return { admin, inserted, tables };
}

/* --------------------------------------------------------------- fixtures */

const COACH = {
  id: "co1",
  user_id: "coach-u",
  first_name: "Alex",
  last_name: "Rivera",
  onboarded_at: "2026-01-01T00:00:00Z",
};
const OTHER_COACH = {
  id: "co2",
  user_id: "coach2-u",
  first_name: "Jamie",
  last_name: "Q",
  onboarded_at: "2026-01-01T00:00:00Z",
};
const PARENT = { id: "p1", user_id: "parent-u", first_name: "Corin", last_name: "Abbott" };
const OTHER_PARENT = { id: "p2", user_id: "parent2-u", first_name: "Sam", last_name: "Oh" };
const MAEVE = {
  id: "a-maeve",
  parent_id: PARENT.id,
  user_id: null,
  first_name: "Maeve",
  last_name: "Abbott",
  self_managed: false,
};
const CALLUM = {
  id: "a-callum",
  parent_id: PARENT.id,
  user_id: null,
  first_name: "Callum",
  last_name: "Abbott",
  self_managed: false,
};
const ADULT = {
  id: "a-adult",
  parent_id: null,
  user_id: "adult-u",
  first_name: "Dana",
  last_name: "Kim",
  self_managed: true,
};
const MINOR_LOGIN = {
  id: "a-minor",
  parent_id: OTHER_PARENT.id,
  user_id: "minor-u",
  first_name: "Mia",
  last_name: "Oh",
  self_managed: false,
};

const link = (
  id: string,
  coach_id: string,
  athlete_id: string,
  created_at: string,
  acks: { coach_ack_at?: string | null; other_ack_at?: string | null } = {},
) => ({
  id,
  coach_id,
  athlete_id,
  created_at,
  coach_ack_at: null,
  other_ack_at: null,
  ...acks,
});

const T1 = "2026-09-01T00:00:00Z";
const T2 = "2026-09-02T00:00:00Z";
const T3 = "2026-09-03T00:00:00Z";

const base = {
  coach_profiles: [COACH, OTHER_COACH],
  parent_profiles: [PARENT, OTHER_PARENT],
  athletes: [MAEVE, CALLUM, ADULT, MINOR_LOGIN],
  message_rooms: [] as Row[],
  coach_athletes: [] as Row[],
};

/* ------------------------------------------------ pending: role resolution */

describe("getPendingConnectionCelebrations — role resolution", () => {
  it("returns role null and no groups for an account with no profile (never an error)", async () => {
    const { admin } = fakeAdmin(base);
    expect(await getPendingConnectionCelebrations(admin, "nobody")).toEqual({
      role: null,
      groups: [],
    });
    expect(await getPendingConnectionCelebrations(admin, "nobody", { apiContract: true })).toEqual({
      role: null,
      groups: [],
    });
  });

  it("returns role null for a minor with a login (self_managed = false)", async () => {
    const { admin } = fakeAdmin({
      ...base,
      coach_athletes: [link("l1", COACH.id, MINOR_LOGIN.id, T1)],
    });
    expect(await getPendingConnectionCelebrations(admin, MINOR_LOGIN.user_id)).toEqual({
      role: null,
      groups: [],
    });
    expect(
      await getPendingConnectionCelebrations(admin, MINOR_LOGIN.user_id, { apiContract: true }),
    ).toEqual({ role: null, groups: [] });
  });

  it("D7: an un-onboarded coach who is also a parent is a coach on the web but a parent on the API", async () => {
    const dual = { ...COACH, id: "co-dual", user_id: "dual-u", onboarded_at: null };
    const dualParent = { ...PARENT, id: "p-dual", user_id: "dual-u" };
    const kid = { ...MAEVE, id: "a-kid", parent_id: dualParent.id };
    const { admin } = fakeAdmin({
      ...base,
      coach_profiles: [COACH, dual],
      parent_profiles: [PARENT, dualParent],
      athletes: [MAEVE, kid],
      coach_athletes: [
        link("l-as-coach", dual.id, MAEVE.id, T1),
        link("l-as-parent", COACH.id, kid.id, T2),
      ],
    });
    const web = await getPendingConnectionCelebrations(admin, "dual-u");
    expect(web.role).toBe("coach");
    expect(web.groups.map((g) => g.id)).toEqual(["l-as-coach"]);

    const api = await getPendingConnectionCelebrations(admin, "dual-u", { apiContract: true });
    expect(api.role).toBe("parent");
    expect(api.groups.map((g) => g.id)).toEqual(["l-as-parent"]);
  });

  it("D7: an onboarded coach who is also a parent is a coach on both", async () => {
    const dualParent = { ...PARENT, id: "p-dual", user_id: COACH.user_id };
    const { admin } = fakeAdmin({
      ...base,
      parent_profiles: [PARENT, dualParent],
      coach_athletes: [link("l1", COACH.id, MAEVE.id, T1)],
    });
    expect((await getPendingConnectionCelebrations(admin, COACH.user_id)).role).toBe("coach");
    expect(
      (await getPendingConnectionCelebrations(admin, COACH.user_id, { apiContract: true })).role,
    ).toBe("coach");
  });

  it("D7: an un-onboarded coach with no other profile is still a coach on the API", async () => {
    const fresh = { ...COACH, id: "co-fresh", user_id: "fresh-u", onboarded_at: null };
    const { admin } = fakeAdmin({ ...base, coach_profiles: [COACH, fresh] });
    expect(await getPendingConnectionCelebrations(admin, "fresh-u", { apiContract: true })).toEqual(
      { role: "coach", groups: [] },
    );
  });

  it("D7: an un-onboarded coach who is a minor athlete gets role null on the API (mirrors /me = athlete), coach on the web", async () => {
    const fresh = { ...COACH, id: "co-fresh", user_id: MINOR_LOGIN.user_id, onboarded_at: null };
    const { admin } = fakeAdmin({ ...base, coach_profiles: [COACH, fresh] });
    expect(
      (await getPendingConnectionCelebrations(admin, MINOR_LOGIN.user_id, { apiContract: true }))
        .role,
    ).toBeNull();
    expect((await getPendingConnectionCelebrations(admin, MINOR_LOGIN.user_id)).role).toBe("coach");
  });

  it("surfaces a failed profile lookup as the generic db error", async () => {
    const { admin } = fakeAdmin(base, ["parent_profiles"]);
    await expect(getPendingConnectionCelebrations(admin, COACH.user_id)).rejects.toThrow(
      "Something went wrong. Please try again.",
    );
  });
});

/* -------------------------------------------------------- pending: coach */

describe("getPendingConnectionCelebrations — coach view", () => {
  it("returns an empty list when every link is acknowledged", async () => {
    const { admin } = fakeAdmin({
      ...base,
      coach_athletes: [link("l1", COACH.id, MAEVE.id, T1, { coach_ack_at: T2 })],
    });
    expect(await getPendingConnectionCelebrations(admin, COACH.user_id)).toEqual({
      role: "coach",
      groups: [],
    });
  });

  it("collapses siblings under one parent, names the parent, and keys the group by its first link", async () => {
    const { admin } = fakeAdmin({
      ...base,
      coach_athletes: [
        link("l-callum", COACH.id, CALLUM.id, T2),
        link("l-maeve", COACH.id, MAEVE.id, T1),
        // Other coach's pending link must not leak in.
        link("l-other", OTHER_COACH.id, MAEVE.id, T1),
        // Already acked by this coach.
        link("l-done", COACH.id, ADULT.id, T1, { coach_ack_at: T3 }),
      ],
    });
    expect(await getPendingConnectionCelebrations(admin, COACH.user_id)).toEqual({
      role: "coach",
      groups: [
        {
          id: "l-maeve",
          linkIds: ["l-maeve", "l-callum"],
          otherName: "Corin Abbott",
          athleteNames: ["Maeve Abbott", "Callum Abbott"],
          roomId: null,
          primaryAthleteId: MAEVE.id,
        },
      ],
    });
  });

  it("gives a self-managed athlete their own group named after the athlete", async () => {
    const { admin } = fakeAdmin({
      ...base,
      coach_athletes: [
        link("l-adult", COACH.id, ADULT.id, T1),
        link("l-maeve", COACH.id, MAEVE.id, T2),
      ],
    });
    const out = await getPendingConnectionCelebrations(admin, COACH.user_id);
    expect(out.groups).toEqual([
      {
        id: "l-adult",
        linkIds: ["l-adult"],
        otherName: "Dana Kim",
        athleteNames: ["Dana Kim"],
        roomId: null,
        primaryAthleteId: ADULT.id,
      },
      {
        id: "l-maeve",
        linkIds: ["l-maeve"],
        otherName: "Corin Abbott",
        athleteNames: ["Maeve Abbott"],
        roomId: null,
        primaryAthleteId: MAEVE.id,
      },
    ]);
  });

  it("orders groups by link created_at then id, so the group id is stable", async () => {
    const { admin } = fakeAdmin({
      ...base,
      // Seeded out of order on purpose; two links share a created_at.
      coach_athletes: [
        link("l-z", COACH.id, ADULT.id, T1),
        link("l-b", COACH.id, CALLUM.id, T1),
        link("l-a", COACH.id, MAEVE.id, T2),
      ],
    });
    const out = await getPendingConnectionCelebrations(admin, COACH.user_id);
    expect(out.groups.map((g) => g.id)).toEqual(["l-b", "l-z"]);
    expect(out.groups[0]!.linkIds).toEqual(["l-b", "l-a"]);
    expect(out.groups[0]!.athleteNames).toEqual(["Callum Abbott", "Maeve Abbott"]);
    expect(out.groups[0]!.primaryAthleteId).toBe(CALLUM.id);
  });

  it("falls back to the athlete's name when the parent row is missing, and skips links whose athlete is gone", async () => {
    const orphan = { ...MAEVE, id: "a-orphan", parent_id: "p-missing" };
    const { admin } = fakeAdmin({
      ...base,
      athletes: [orphan],
      coach_athletes: [
        link("l-orphan", COACH.id, orphan.id, T1),
        link("l-ghost", COACH.id, "a-deleted", T2),
      ],
    });
    const out = await getPendingConnectionCelebrations(admin, COACH.user_id);
    expect(out.groups).toEqual([
      {
        id: "l-orphan",
        linkIds: ["l-orphan"],
        otherName: "Maeve Abbott",
        athleteNames: ["Maeve Abbott"],
        roomId: null,
        primaryAthleteId: orphan.id,
      },
    ]);
  });
});

/* ------------------------------------------------------- pending: parent */

describe("getPendingConnectionCelebrations — parent view", () => {
  it("returns an empty list for a parent with no athletes", async () => {
    const { admin } = fakeAdmin({ ...base, athletes: [ADULT] });
    expect(await getPendingConnectionCelebrations(admin, PARENT.user_id)).toEqual({
      role: "parent",
      groups: [],
    });
  });

  it("groups by coach, names the coach, and links an existing room", async () => {
    const { admin } = fakeAdmin({
      ...base,
      message_rooms: [{ id: "room-callum", coach_id: COACH.id, athlete_id: CALLUM.id }],
      coach_athletes: [
        link("l-maeve", COACH.id, MAEVE.id, T1),
        link("l-callum", COACH.id, CALLUM.id, T2),
        link("l-other-coach", OTHER_COACH.id, MAEVE.id, T3),
        // Someone else's child — must not appear.
        link("l-not-mine", COACH.id, MINOR_LOGIN.id, T1),
        // Already acked from the parent side.
        link("l-done", OTHER_COACH.id, CALLUM.id, T1, { other_ack_at: T3 }),
      ],
    });
    expect(await getPendingConnectionCelebrations(admin, PARENT.user_id)).toEqual({
      role: "parent",
      groups: [
        {
          id: "l-maeve",
          linkIds: ["l-maeve", "l-callum"],
          otherName: "Alex Rivera",
          athleteNames: [],
          // Parity quirk: the first link had no room, so the sibling supplied both.
          roomId: "room-callum",
          primaryAthleteId: CALLUM.id,
        },
        {
          id: "l-other-coach",
          linkIds: ["l-other-coach"],
          otherName: "Jamie Q",
          athleteNames: [],
          roomId: null,
          primaryAthleteId: MAEVE.id,
        },
      ],
    });
  });

  it("keeps the first link's room and athlete once a room is found", async () => {
    const { admin } = fakeAdmin({
      ...base,
      message_rooms: [
        { id: "room-maeve", coach_id: COACH.id, athlete_id: MAEVE.id },
        { id: "room-callum", coach_id: COACH.id, athlete_id: CALLUM.id },
      ],
      coach_athletes: [link("l-maeve", COACH.id, MAEVE.id, T1), link("l-callum", COACH.id, CALLUM.id, T2)],
    });
    const out = await getPendingConnectionCelebrations(admin, PARENT.user_id);
    expect(out.groups[0]!.roomId).toBe("room-maeve");
    expect(out.groups[0]!.primaryAthleteId).toBe(MAEVE.id);
  });

  it('says "your coach" when the coach profile is missing', async () => {
    const { admin } = fakeAdmin({
      ...base,
      coach_profiles: [],
      coach_athletes: [link("l-maeve", COACH.id, MAEVE.id, T1)],
    });
    const out = await getPendingConnectionCelebrations(admin, PARENT.user_id);
    expect(out.groups[0]!.otherName).toBe("your coach");
  });
});

/* ------------------------------------------------ pending: adult athlete */

describe("getPendingConnectionCelebrations — adult athlete view", () => {
  it("returns one group per link with the room for that coach and the caller as primary athlete", async () => {
    const { admin } = fakeAdmin({
      ...base,
      message_rooms: [
        { id: "room-1", coach_id: COACH.id, athlete_id: ADULT.id },
        // Same coach, a different athlete — must not be picked.
        { id: "room-x", coach_id: OTHER_COACH.id, athlete_id: MAEVE.id },
      ],
      coach_athletes: [
        link("l-2", OTHER_COACH.id, ADULT.id, T2),
        link("l-1", COACH.id, ADULT.id, T1),
        link("l-done", COACH.id, ADULT.id, T1, { other_ack_at: T3 }),
        link("l-not-mine", COACH.id, MAEVE.id, T1),
      ],
    });
    expect(await getPendingConnectionCelebrations(admin, ADULT.user_id)).toEqual({
      role: "adult-athlete",
      groups: [
        {
          id: "l-1",
          linkIds: ["l-1"],
          otherName: "Alex Rivera",
          athleteNames: [],
          roomId: "room-1",
          primaryAthleteId: ADULT.id,
        },
        {
          id: "l-2",
          linkIds: ["l-2"],
          otherName: "Jamie Q",
          athleteNames: [],
          roomId: null,
          primaryAthleteId: ADULT.id,
        },
      ],
    });
  });

  it("returns an empty list when nothing is pending", async () => {
    const { admin } = fakeAdmin(base);
    expect(await getPendingConnectionCelebrations(admin, ADULT.user_id)).toEqual({
      role: "adult-athlete",
      groups: [],
    });
  });
});

/* ------------------------------------------------------------------ ack */

describe("acknowledgeConnection", () => {
  it("coach: stamps coach_ack_at on owned links only and ignores unowned ids", async () => {
    const { admin, tables } = fakeAdmin({
      ...base,
      coach_athletes: [
        link("l-mine", COACH.id, MAEVE.id, T1),
        link("l-theirs", OTHER_COACH.id, MAEVE.id, T1),
      ],
    });
    const out = await acknowledgeConnection(admin, COACH.user_id, {
      linkIds: ["l-mine", "l-theirs", "l-nope"],
    });
    expect(out).toEqual({ ok: true });
    const byId = new Map(tables.coach_athletes!.map((r) => [r.id, r]));
    expect(byId.get("l-mine")!.coach_ack_at).toBeTruthy();
    expect(byId.get("l-mine")!.other_ack_at).toBeNull();
    expect(byId.get("l-theirs")!.coach_ack_at).toBeNull();
  });

  it("parent: stamps other_ack_at only on links for the parent's own athletes", async () => {
    const { admin, tables } = fakeAdmin({
      ...base,
      coach_athletes: [
        link("l-maeve", COACH.id, MAEVE.id, T1),
        link("l-callum", COACH.id, CALLUM.id, T1),
        link("l-not-mine", COACH.id, MINOR_LOGIN.id, T1),
      ],
    });
    expect(
      await acknowledgeConnection(admin, PARENT.user_id, {
        linkIds: ["l-maeve", "l-callum", "l-not-mine"],
      }),
    ).toEqual({ ok: true });
    const byId = new Map(tables.coach_athletes!.map((r) => [r.id, r]));
    expect(byId.get("l-maeve")!.other_ack_at).toBeTruthy();
    expect(byId.get("l-callum")!.other_ack_at).toBeTruthy();
    expect(byId.get("l-maeve")!.coach_ack_at).toBeNull();
    expect(byId.get("l-not-mine")!.other_ack_at).toBeNull();
  });

  it("parent: is a silent no-op when none of the ids are owned", async () => {
    const { admin, tables } = fakeAdmin({
      ...base,
      coach_athletes: [link("l-not-mine", COACH.id, MINOR_LOGIN.id, T1)],
    });
    expect(await acknowledgeConnection(admin, PARENT.user_id, { linkIds: ["l-not-mine"] })).toEqual(
      { ok: true },
    );
    expect(tables.coach_athletes![0]!.other_ack_at).toBeNull();
  });

  it("adult athlete: stamps other_ack_at on their own links only", async () => {
    const { admin, tables } = fakeAdmin({
      ...base,
      coach_athletes: [link("l-mine", COACH.id, ADULT.id, T1), link("l-maeve", COACH.id, MAEVE.id, T1)],
    });
    expect(
      await acknowledgeConnection(admin, ADULT.user_id, { linkIds: ["l-mine", "l-maeve"] }),
    ).toEqual({ ok: true });
    const byId = new Map(tables.coach_athletes!.map((r) => [r.id, r]));
    expect(byId.get("l-mine")!.other_ack_at).toBeTruthy();
    expect(byId.get("l-maeve")!.other_ack_at).toBeNull();
  });

  it("re-acking an acknowledged link only bumps the timestamp (idempotent)", async () => {
    const { admin, tables } = fakeAdmin({
      ...base,
      coach_athletes: [link("l-mine", COACH.id, MAEVE.id, T1, { coach_ack_at: T2 })],
    });
    expect(await acknowledgeConnection(admin, COACH.user_id, { linkIds: ["l-mine"] })).toEqual({
      ok: true,
    });
    expect(tables.coach_athletes![0]!.coach_ack_at > T2).toBe(true);
  });

  it("rejects a caller with no role with 403 wrong_role", async () => {
    const { admin } = fakeAdmin(base);
    await expect(
      acknowledgeConnection(admin, "nobody", { linkIds: ["l-1"] }),
    ).rejects.toMatchObject({ code: "wrong_role", status: 403 });
    await expect(
      acknowledgeConnection(admin, "nobody", { linkIds: ["l-1"] }, { apiContract: true }),
    ).rejects.toMatchObject({ code: "wrong_role", status: 403 });
  });

  it("rejects a minor with a login with 403 wrong_role and writes nothing", async () => {
    const { admin, tables } = fakeAdmin({
      ...base,
      coach_athletes: [link("l-minor", COACH.id, MINOR_LOGIN.id, T1)],
    });
    await expect(
      acknowledgeConnection(admin, MINOR_LOGIN.user_id, { linkIds: ["l-minor"] }),
    ).rejects.toMatchObject({ code: "wrong_role", status: 403 });
    expect(tables.coach_athletes![0]!.other_ack_at).toBeNull();
  });

  it("D7: an un-onboarded coach who is also a parent acks the coach side on the web and the parent side on the API", async () => {
    const dual = { ...COACH, id: "co-dual", user_id: "dual-u", onboarded_at: null };
    const dualParent = { ...PARENT, id: "p-dual", user_id: "dual-u" };
    const kid = { ...MAEVE, id: "a-kid", parent_id: dualParent.id };
    const seed = {
      ...base,
      coach_profiles: [COACH, dual],
      parent_profiles: [PARENT, dualParent],
      athletes: [MAEVE, kid],
      coach_athletes: [
        link("l-as-coach", dual.id, MAEVE.id, T1),
        link("l-as-parent", COACH.id, kid.id, T2),
      ],
    };
    const web = fakeAdmin(seed);
    await acknowledgeConnection(web.admin, "dual-u", { linkIds: ["l-as-coach", "l-as-parent"] });
    const webById = new Map(web.tables.coach_athletes!.map((r) => [r.id, r]));
    expect(webById.get("l-as-coach")!.coach_ack_at).toBeTruthy();
    expect(webById.get("l-as-parent")!.other_ack_at).toBeNull();

    const api = fakeAdmin(seed);
    await acknowledgeConnection(
      api.admin,
      "dual-u",
      { linkIds: ["l-as-coach", "l-as-parent"] },
      { apiContract: true },
    );
    const apiById = new Map(api.tables.coach_athletes!.map((r) => [r.id, r]));
    expect(apiById.get("l-as-parent")!.other_ack_at).toBeTruthy();
    expect(apiById.get("l-as-coach")!.coach_ack_at).toBeNull();
  });

  it("surfaces a failed profile lookup instead of falling through to no role", async () => {
    const { admin } = fakeAdmin(
      { ...base, coach_athletes: [link("l-mine", COACH.id, MAEVE.id, T1)] },
      ["coach_profiles"],
    );
    await expect(
      acknowledgeConnection(admin, COACH.user_id, { linkIds: ["l-mine"] }),
    ).rejects.toThrow("Something went wrong. Please try again.");
  });

  it("parent: surfaces a failed owned-athletes lookup instead of silently returning ok (writes nothing)", async () => {
    // The profile lookup (athletes by user_id) must succeed so the parent
    // branch is reached; only the second athletes query — the ownership
    // lookup by parent_id — fails. The web used to treat that as "owns
    // nothing" and return { ok: true } without writing.
    const seed = { ...base, coach_athletes: [link("l-maeve", COACH.id, MAEVE.id, T1)] };
    const healthy = fakeAdmin(seed);
    const broken = fakeAdmin(seed, ["athletes"]);
    let athletesQueries = 0;
    const admin = {
      from: (table: Parameters<ApiContext["admin"]["from"]>[0]) =>
        table === "athletes" && ++athletesQueries === 2
          ? broken.admin.from(table)
          : healthy.admin.from(table),
    } as unknown as ApiContext["admin"];
    await expect(
      acknowledgeConnection(admin, PARENT.user_id, { linkIds: ["l-maeve"] }),
    ).rejects.toThrow("Something went wrong. Please try again.");
    expect(athletesQueries).toBe(2);
    expect(healthy.tables.coach_athletes![0]!.other_ack_at).toBeNull();
  });

  it("parent: surfaces a failed link lookup instead of silently returning ok (writes nothing)", async () => {
    const { admin, tables } = fakeAdmin(
      { ...base, coach_athletes: [link("l-maeve", COACH.id, MAEVE.id, T1)] },
      ["coach_athletes"],
    );
    await expect(
      acknowledgeConnection(admin, PARENT.user_id, { linkIds: ["l-maeve"] }),
    ).rejects.toThrow("Something went wrong. Please try again.");
    expect(tables.coach_athletes![0]!.other_ack_at).toBeNull();
  });
});

describe("mergeAckLinkIds", () => {
  it("puts the path id first and de-duplicates", () => {
    expect(mergeAckLinkIds("a", ["b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
    expect(mergeAckLinkIds("a", undefined)).toEqual(["a"]);
  });
});
