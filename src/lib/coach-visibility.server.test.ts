import { describe, expect, it, mock } from "bun:test";
import {
  disconnectCoachVisibility,
  listCoachVisibility,
  listMyCoachVisibility,
  respondToCoachVisibility,
  setCoachVisibility,
  toParentCoachVisibility,
} from "./coach-visibility.server";
import {
  myCoachVisibilitySchema,
  parentCoachVisibilitySchema,
} from "./api/coach-visibility-schema";

/* -------------------------------------------------------------------------- */
/* The email sender is best-effort and never throws; here it only records     */
/* who it was asked to write to.                                              */
/* -------------------------------------------------------------------------- */

type SentMail = {
  to: string;
  coachName: string;
  otherCoachName: string;
  athleteName: string;
  parentName: string;
};
const sent: SentMail[] = [];
mock.module("./coach-visibility-emails.server", () => ({
  sendCoachVisibilityRequest: async (params: SentMail) => {
    sent.push(params);
  },
}));

/* -------------------------------------------------------------------------- */
/* Same small, stateful, in-memory Supabase-shaped fake as                    */
/* competition-recap.server.test.ts, plus `.or("a.eq.x,b.eq.y")` and          */
/* `auth.admin.getUserById` for the email fan-out.                            */
/* -------------------------------------------------------------------------- */

type Row = Record<string, any>;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `row_${idCounter}`;
}

function orFilter(expr: string): (r: Row) => boolean {
  const clauses = expr.split(",").map((part) => {
    const [col, op, ...rest] = part.split(".");
    if (op !== "eq") throw new Error(`fake .or() only supports eq, got ${op}`);
    return { col: col!, value: rest.join(".") };
  });
  return (r) => clauses.some((c) => r[c.col] === c.value);
}

function fakeAdmin(seed: Record<string, Row[]>, emails: Record<string, string | null> = {}) {
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
      or: (expr: string) =>
        builder(table, [...filters, orFilter(expr)], mode, payload, onConflict, order, limitN),
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

  const admin: any = {
    from: (table: string) => builder(table, [], "select", null, undefined, []),
    auth: {
      admin: {
        getUserById: async (userId: string) => ({
          data: { user: emails[userId] ? { email: emails[userId] } : null },
          error: null,
        }),
      },
    },
  };
  return { admin, inserted, tables };
}

/* ------------------------------------------------------------------ seed */

// Ids are ordered strings so `orderPair` behaves like it does on real uuids.
const PAYER = {
  id: "p1",
  user_id: "payer-u",
  first_name: "Corin",
  last_name: "Abbott",
  subscription_status: "active",
  current_period_end: null,
};
const NO_PLAN = {
  id: "p2",
  user_id: "noplan-u",
  first_name: "Nia",
  last_name: "Ortiz",
  subscription_status: null,
  current_period_end: null,
};
const CO = {
  id: "p3",
  user_id: "co-u",
  first_name: "Cam",
  last_name: "Abbott",
  subscription_status: null,
  current_period_end: null,
};

const A1 = {
  id: "a1",
  first_name: "Jamie",
  last_name: "Abbott",
  parent_id: "p1",
  created_at: "2026-01-01",
};
const A2 = {
  id: "a2",
  first_name: "Ola",
  last_name: "Ortiz",
  parent_id: "p2",
  created_at: "2026-01-02",
};

const C1 = { id: "c1", user_id: "c1-u", first_name: "Tami", last_name: "Taylor" };
const C2 = { id: "c2", user_id: "c2-u", first_name: "David", last_name: "Wallace" };
const C3 = { id: "c3", user_id: "c3-u", first_name: "", last_name: "" };

const EMAILS = { "c1-u": "tami@example.com", "c2-u": "david@example.com", "c3-u": null };

function seed(extra: Record<string, Row[]> = {}) {
  return fakeAdmin(
    {
      parent_profiles: [PAYER, NO_PLAN, CO],
      athletes: [A1, A2],
      // `athletes` is the embedded-select shape guardianAthleteAccess reads
      // (this fake's `select()` is a no-op, so the join must be baked into
      // the seed row itself, same as the coach_profiles embeds below).
      athlete_guardians: [
        { id: "g1", athlete_id: "a1", parent_id: "p3", role: "co", athletes: { parent_id: "p1" } },
      ],
      coach_profiles: [C1, C2, C3],
      coach_athletes: [
        { athlete_id: "a1", coach_id: "c1" },
        { athlete_id: "a1", coach_id: "c2" },
        { athlete_id: "a1", coach_id: "c3" },
        { athlete_id: "a2", coach_id: "c1" },
      ],
      athlete_coach_visibility: [],
      coach_visibility_links: [],
      ...extra,
    },
    EMAILS,
  );
}

const link = (
  id: string,
  athlete: string,
  a: string,
  b: string,
  aStatus: string,
  bStatus: string,
) => ({
  id,
  athlete_id: athlete,
  coach_a_id: a,
  coach_b_id: b,
  a_status: aStatus,
  b_status: bStatus,
});

/* ------------------------------------------------------ listCoachVisibility */

describe("listCoachVisibility", () => {
  it("rejects a caller without a parent profile as wrong_role", async () => {
    const { admin } = seed();
    await expect(listCoachVisibility(admin, "c1-u")).rejects.toMatchObject({
      code: "wrong_role",
      status: 403,
    });
    await expect(listCoachVisibility(admin, "c1-u")).rejects.toThrow("Parent profile not found.");
  });

  it("returns the web shape: every reachable athlete, coaches, per-coach state and pairs", async () => {
    const { admin } = seed({
      athlete_coach_visibility: [
        { athlete_id: "a1", coach_id: "c1" },
        { athlete_id: "a1", coach_id: "c2" },
      ],
      coach_visibility_links: [link("l1", "a1", "c1", "c2", "accepted", "pending")],
    });
    const out = await listCoachVisibility(admin, "payer-u");
    expect(out).toEqual({
      planActive: true,
      athletes: [
        {
          id: "a1",
          firstName: "Jamie",
          lastName: "Abbott",
          locked: false,
          coaches: [
            {
              coachId: "c1",
              name: "Tami Taylor",
              enabled: true,
              status: "pending",
              pairs: [
                {
                  otherCoachId: "c2",
                  otherName: "David Wallace",
                  myStatus: "accepted",
                  theirStatus: "pending",
                },
              ],
            },
            {
              coachId: "c2",
              name: "David Wallace",
              enabled: true,
              status: "pending",
              pairs: [
                {
                  otherCoachId: "c1",
                  otherName: "Tami Taylor",
                  myStatus: "pending",
                  theirStatus: "accepted",
                },
              ],
            },
            { coachId: "c3", name: "Coach", enabled: false, status: "off", pairs: [] },
          ],
        },
      ],
    });
  });

  it("apiContract names the pair sides coachStatus / otherStatus and matches the output schema", async () => {
    const { admin } = seed({
      athlete_coach_visibility: [
        { athlete_id: "a1", coach_id: "c1" },
        { athlete_id: "a1", coach_id: "c2" },
      ],
      coach_visibility_links: [link("l1", "a1", "c1", "c2", "accepted", "declined")],
    });
    const out = await listCoachVisibility(admin, "payer-u", { apiContract: true });
    expect(out.athletes[0]!.coaches[0]).toEqual({
      coachId: "c1",
      name: "Tami Taylor",
      enabled: true,
      status: "declined",
      pairs: [
        {
          otherCoachId: "c2",
          otherName: "David Wallace",
          coachStatus: "accepted",
          otherStatus: "declined",
        },
      ],
    });
    expect(parentCoachVisibilitySchema.parse(out)).toEqual(out);
    // The mapper is pure: same data, renamed sides only.
    const web = await listCoachVisibility(admin, "payer-u");
    expect(toParentCoachVisibility(web)).toEqual(out);
  });

  it("derives waiting (enabled, no links) and connected (both accepted)", async () => {
    const { admin } = seed({
      athlete_coach_visibility: [
        { athlete_id: "a1", coach_id: "c1" },
        { athlete_id: "a1", coach_id: "c2" },
        { athlete_id: "a1", coach_id: "c3" },
      ],
      coach_visibility_links: [link("l1", "a1", "c1", "c2", "accepted", "accepted")],
    });
    const out = await listCoachVisibility(admin, "payer-u");
    const byId = new Map(out.athletes[0]!.coaches.map((c) => [c.coachId, c.status]));
    expect(byId.get("c1")).toBe("connected");
    expect(byId.get("c2")).toBe("connected");
    expect(byId.get("c3")).toBe("waiting");
  });

  it("a co-guardian sees only their athlete and is covered by the primary's plan", async () => {
    const { admin } = seed();
    const out = await listCoachVisibility(admin, "co-u");
    expect(out.planActive).toBe(true);
    expect(out.athletes.map((a) => a.id)).toEqual(["a1"]);
    expect(out.athletes[0]!.locked).toBe(false);
  });

  it("a co-guardian's athlete is locked, with no coaches listed, once the primary's Team plan lapses", async () => {
    const lapsedPayer = { ...PAYER, subscription_status: null };
    const { admin } = seed({ parent_profiles: [lapsedPayer, NO_PLAN, CO] });
    const out = await listCoachVisibility(admin, "co-u");
    expect(out.athletes).toEqual([
      { id: "a1", firstName: "Jamie", lastName: "Abbott", locked: true, coaches: [] },
    ]);
  });

  it("planActive is false for a primary parent without a plan; athletes still listed", async () => {
    const { admin } = seed();
    const out = await listCoachVisibility(admin, "noplan-u");
    expect(out.planActive).toBe(false);
    expect(out.athletes.map((a) => a.id)).toEqual(["a2"]);
    expect(out.athletes[0]!.coaches.map((c) => c.coachId)).toEqual(["c1"]);
  });
});

/* ------------------------------------------------------- setCoachVisibility */

describe("setCoachVisibility", () => {
  it("rejects non-parents as wrong_role", async () => {
    const { admin } = seed();
    await expect(
      setCoachVisibility(admin, "c1-u", { athleteId: "a1", coachId: "c1", enabled: true }),
    ).rejects.toMatchObject({ code: "wrong_role", status: 403 });
  });

  it("rejects an athlete the parent cannot reach as forbidden", async () => {
    const { admin } = seed();
    await expect(
      setCoachVisibility(admin, "payer-u", { athleteId: "a2", coachId: "c1", enabled: true }),
    ).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
      message: "Not authorized to manage this athlete.",
    });
    // Turning off is gated the same way.
    await expect(
      setCoachVisibility(admin, "payer-u", { athleteId: "a2", coachId: "c1", enabled: false }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("404s when the reachable athlete row is gone", async () => {
    const { admin } = seed({
      athlete_guardians: [{ id: "g9", athlete_id: "ghost", parent_id: "p1", role: "co" }],
    });
    await expect(
      setCoachVisibility(admin, "payer-u", { athleteId: "ghost", coachId: "c1", enabled: true }),
    ).rejects.toMatchObject({ code: "not_found", status: 404, message: "Athlete not found." });
  });

  it("enabling without a Team plan is plan_required", async () => {
    const { admin } = seed();
    await expect(
      setCoachVisibility(admin, "noplan-u", { athleteId: "a2", coachId: "c1", enabled: true }),
    ).rejects.toMatchObject({
      code: "plan_required",
      status: 403,
      message: "Start the Team plan to connect coaches.",
    });
  });

  it("enabling a coach who is not on the athlete is unprocessable", async () => {
    const { admin } = seed();
    await expect(
      setCoachVisibility(admin, "payer-u", { athleteId: "a1", coachId: "c9", enabled: true }),
    ).rejects.toMatchObject({
      code: "unprocessable",
      status: 422,
      message: "That coach isn't connected to this athlete.",
    });
  });

  it("enabling upserts the opt-in, links every other opted-in coach, and emails both sides", async () => {
    sent.length = 0;
    const { admin, tables } = seed({
      athlete_coach_visibility: [{ athlete_id: "a1", coach_id: "c2" }],
    });
    const out = await setCoachVisibility(admin, "payer-u", {
      athleteId: "a1",
      coachId: "c1",
      enabled: true,
    });
    expect(out).toEqual({ ok: true });
    expect(tables.athlete_coach_visibility).toEqual([
      { athlete_id: "a1", coach_id: "c2" },
      {
        id: expect.stringMatching(/^row_/),
        athlete_id: "a1",
        coach_id: "c1",
        enabled_by_parent_id: "p1",
      },
    ]);
    expect(tables.coach_visibility_links).toEqual([
      { id: expect.stringMatching(/^row_/), athlete_id: "a1", coach_a_id: "c1", coach_b_id: "c2" },
    ]);
    expect(sent.map((m) => m.to)).toEqual(["tami@example.com", "david@example.com"]);
    expect(sent[0]).toEqual({
      to: "tami@example.com",
      coachName: "Tami Taylor",
      otherCoachName: "David Wallace",
      athleteName: "Jamie Abbott",
      parentName: "Corin Abbott",
    });
  });

  it("is idempotent by value: re-enabling creates no new links and sends no mail; declined pairs stay declined", async () => {
    sent.length = 0;
    const { admin, tables } = seed({
      athlete_coach_visibility: [
        { athlete_id: "a1", coach_id: "c1", enabled_by_parent_id: "p1" },
        { athlete_id: "a1", coach_id: "c2" },
      ],
      coach_visibility_links: [link("l1", "a1", "c1", "c2", "declined", "pending")],
    });
    await setCoachVisibility(admin, "payer-u", { athleteId: "a1", coachId: "c1", enabled: true });
    expect(tables.athlete_coach_visibility).toHaveLength(2);
    expect(tables.coach_visibility_links).toEqual([
      link("l1", "a1", "c1", "c2", "declined", "pending"),
    ]);
    expect(sent).toEqual([]);
  });

  it("skips the email for a coach whose account has no address", async () => {
    sent.length = 0;
    const { admin } = seed({
      athlete_coach_visibility: [{ athlete_id: "a1", coach_id: "c3" }],
    });
    await setCoachVisibility(admin, "payer-u", { athleteId: "a1", coachId: "c1", enabled: true });
    expect(sent.map((m) => m.to)).toEqual(["tami@example.com"]);
  });

  it("a covered co-guardian can enable; plan is checked on the athlete's primary", async () => {
    sent.length = 0;
    const { admin, tables } = seed();
    await setCoachVisibility(admin, "co-u", { athleteId: "a1", coachId: "c1", enabled: true });
    expect(tables.athlete_coach_visibility).toEqual([
      {
        id: expect.stringMatching(/^row_/),
        athlete_id: "a1",
        coach_id: "c1",
        enabled_by_parent_id: "p3",
      },
    ]);
    expect(sent).toEqual([]); // no other opted-in coach yet
  });

  it("a co-guardian of an athlete whose primary has no plan is plan_required", async () => {
    const { admin } = seed({
      athlete_guardians: [{ id: "g2", athlete_id: "a2", parent_id: "p3", role: "co" }],
    });
    await expect(
      setCoachVisibility(admin, "co-u", { athleteId: "a2", coachId: "c1", enabled: true }),
    ).rejects.toMatchObject({ code: "plan_required", status: 403 });
  });

  it("disabling drops the opt-in and every link naming that coach for the athlete only", async () => {
    const { admin, tables } = seed({
      athlete_coach_visibility: [
        { athlete_id: "a1", coach_id: "c1" },
        { athlete_id: "a1", coach_id: "c2" },
        { athlete_id: "a1", coach_id: "c3" },
        { athlete_id: "a2", coach_id: "c1" },
      ],
      coach_visibility_links: [
        link("l1", "a1", "c1", "c2", "accepted", "accepted"),
        link("l2", "a1", "c2", "c3", "pending", "pending"),
        link("l3", "a1", "c1", "c3", "pending", "pending"),
        link("l4", "a2", "c1", "c2", "pending", "pending"),
      ],
    });
    const out = await setCoachVisibility(admin, "payer-u", {
      athleteId: "a1",
      coachId: "c2",
      enabled: false,
    });
    expect(out).toEqual({ ok: true });
    expect(tables.athlete_coach_visibility).toEqual([
      { athlete_id: "a1", coach_id: "c1" },
      { athlete_id: "a1", coach_id: "c3" },
      { athlete_id: "a2", coach_id: "c1" },
    ]);
    expect(tables.coach_visibility_links.map((l) => l.id)).toEqual(["l3", "l4"]);
  });

  it("disabling needs no plan and no coach link (parity)", async () => {
    const { admin } = seed();
    await expect(
      setCoachVisibility(admin, "noplan-u", { athleteId: "a2", coachId: "c9", enabled: false }),
    ).resolves.toEqual({ ok: true });
  });
});

/* ----------------------------------------------------- listMyCoachVisibility */

describe("listMyCoachVisibility", () => {
  it("non-coaches get three empty arrays, never an error", async () => {
    const { admin } = seed();
    expect(await listMyCoachVisibility(admin, "payer-u")).toEqual({
      pending: [],
      connected: [],
      awaiting: [],
    });
    expect(await listMyCoachVisibility(admin, "nobody")).toEqual({
      pending: [],
      connected: [],
      awaiting: [],
    });
  });

  it("a coach with no links gets empty buckets", async () => {
    const { admin } = seed();
    expect(await listMyCoachVisibility(admin, "c1-u")).toEqual({
      pending: [],
      connected: [],
      awaiting: [],
    });
  });

  it("buckets links from the caller's own side; declined links appear nowhere", async () => {
    const { admin } = seed({
      coach_visibility_links: [
        link("l1", "a1", "c1", "c2", "accepted", "pending"), // c2 pending, c1 awaiting
        link("l2", "a1", "c2", "c3", "accepted", "accepted"), // connected
        link("l3", "a2", "c1", "c2", "declined", "pending"), // they declined → hidden for c2
        link("l4", "a2", "c2", "c3", "declined", "accepted"), // I declined → hidden
        link("l5", "a1", "c1", "c3", "pending", "pending"), // not mine
      ],
    });
    const out = await listMyCoachVisibility(admin, "c2-u");
    expect(out).toEqual({
      pending: [
        {
          id: "l1",
          athleteId: "a1",
          athleteName: "Jamie Abbott",
          coachName: "Tami Taylor",
          myStatus: "pending",
          theirStatus: "accepted",
        },
      ],
      connected: [
        {
          id: "l2",
          athleteId: "a1",
          athleteName: "Jamie Abbott",
          coachName: "Coach",
          myStatus: "accepted",
          theirStatus: "accepted",
        },
      ],
      awaiting: [],
    });
    expect(myCoachVisibilitySchema.parse(out)).toEqual(out);

    const mine = await listMyCoachVisibility(admin, "c1-u");
    expect(mine.awaiting.map((l) => l.id)).toEqual(["l1"]);
    expect(mine.pending.map((l) => l.id)).toEqual(["l5"]);
    expect(mine.connected).toEqual([]);
  });

  it("falls back to 'Athlete' when the athlete row is gone (stale link, parity)", async () => {
    const { admin } = seed({
      coach_visibility_links: [link("l1", "gone", "c1", "c2", "pending", "pending")],
    });
    const out = await listMyCoachVisibility(admin, "c1-u");
    expect(out.pending[0]!.athleteName).toBe("Athlete");
  });
});

/* --------------------------------------------------- respondToCoachVisibility */

describe("respondToCoachVisibility", () => {
  it("rejects non-coaches as wrong_role", async () => {
    const { admin } = seed();
    await expect(
      respondToCoachVisibility(admin, "payer-u", { linkId: "l1", accept: true }),
    ).rejects.toMatchObject({
      code: "wrong_role",
      status: 403,
      message: "Coach profile not found.",
    });
  });

  it("a missing link is 404 on the API and the web's forbidden message otherwise", async () => {
    const { admin } = seed();
    await expect(
      respondToCoachVisibility(
        admin,
        "c1-u",
        { linkId: "nope", accept: true },
        { apiContract: true },
      ),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      respondToCoachVisibility(admin, "c1-u", { linkId: "nope", accept: true }),
    ).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
      message: "Not authorized to respond to this request.",
    });
  });

  it("a link that does not name the caller is forbidden in both modes", async () => {
    const { admin, tables } = seed({
      coach_visibility_links: [link("l1", "a1", "c1", "c2", "pending", "pending")],
    });
    await expect(
      respondToCoachVisibility(
        admin,
        "c3-u",
        { linkId: "l1", accept: true },
        { apiContract: true },
      ),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(
      respondToCoachVisibility(admin, "c3-u", { linkId: "l1", accept: true }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(tables.coach_visibility_links[0]).toEqual(
      link("l1", "a1", "c1", "c2", "pending", "pending"),
    );
  });

  it("writes only the caller's side: a_status as coach_a, b_status as coach_b", async () => {
    const { admin, tables } = seed({
      coach_visibility_links: [
        link("l1", "a1", "c1", "c2", "pending", "pending"),
        link("l2", "a2", "c1", "c2", "pending", "pending"),
      ],
    });
    expect(
      await respondToCoachVisibility(
        admin,
        "c1-u",
        { linkId: "l1", accept: true },
        { apiContract: true },
      ),
    ).toEqual({ ok: true });
    expect(tables.coach_visibility_links[0]).toEqual(
      link("l1", "a1", "c1", "c2", "accepted", "pending"),
    );

    expect(await respondToCoachVisibility(admin, "c2-u", { linkId: "l2", accept: false })).toEqual({
      ok: true,
    });
    expect(tables.coach_visibility_links[1]).toEqual(
      link("l2", "a2", "c1", "c2", "pending", "declined"),
    );
  });

  it("has no state precondition: accept after decline flips back (idempotent by value)", async () => {
    const { admin, tables } = seed({
      coach_visibility_links: [link("l1", "a1", "c1", "c2", "pending", "declined")],
    });
    await respondToCoachVisibility(admin, "c2-u", { linkId: "l1", accept: true });
    await respondToCoachVisibility(admin, "c2-u", { linkId: "l1", accept: true });
    expect(tables.coach_visibility_links[0]).toEqual(
      link("l1", "a1", "c1", "c2", "pending", "accepted"),
    );
  });
});

/* --------------------------------------------------- disconnectCoachVisibility */

describe("disconnectCoachVisibility", () => {
  it("rejects non-coaches as wrong_role", async () => {
    const { admin } = seed();
    await expect(disconnectCoachVisibility(admin, "co-u", { linkId: "l1" })).rejects.toMatchObject({
      code: "wrong_role",
      status: 403,
    });
  });

  it("a missing link is 404 on the API and the web's 'Not authorized.' otherwise", async () => {
    const { admin } = seed();
    await expect(
      disconnectCoachVisibility(admin, "c1-u", { linkId: "nope" }, { apiContract: true }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      disconnectCoachVisibility(admin, "c1-u", { linkId: "nope" }),
    ).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
      message: "Not authorized.",
    });
  });

  it("a link that does not name the caller is forbidden", async () => {
    const { admin } = seed({
      coach_visibility_links: [link("l1", "a1", "c1", "c2", "accepted", "accepted")],
    });
    await expect(
      disconnectCoachVisibility(admin, "c3-u", { linkId: "l1" }, { apiContract: true }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403, message: "Not authorized." });
  });

  it("soft-declines only the caller's side and keeps the row", async () => {
    const { admin, tables } = seed({
      coach_visibility_links: [
        link("l1", "a1", "c1", "c2", "accepted", "accepted"),
        link("l2", "a2", "c1", "c2", "accepted", "accepted"),
      ],
    });
    expect(
      await disconnectCoachVisibility(admin, "c2-u", { linkId: "l1" }, { apiContract: true }),
    ).toEqual({
      ok: true,
    });
    expect(tables.coach_visibility_links[0]).toEqual(
      link("l1", "a1", "c1", "c2", "accepted", "declined"),
    );
    expect(await disconnectCoachVisibility(admin, "c1-u", { linkId: "l2" })).toEqual({ ok: true });
    expect(tables.coach_visibility_links[1]).toEqual(
      link("l2", "a2", "c1", "c2", "declined", "accepted"),
    );
    expect(tables.coach_visibility_links).toHaveLength(2);
  });
});
