import { describe, expect, it, mock } from "bun:test";
import type { ApiContext } from "./api/auth";
import {
  claimGuardianInvite,
  INVITE_TTL_DAYS,
  inviteGuardian,
  listTeamGuardians,
  previewGuardianInvite,
  removeGuardian,
  removeGuardianById,
  resendTeamGuardianInvite,
  revokeGuardianInvite,
} from "./team-guardians.server";

/* -------------------------------------------------------------------------- */
/* Email sender: recorded, never rendered. Only the recipient is asserted.    */
/* -------------------------------------------------------------------------- */

type SentInvite = {
  to: string;
  athleteName: string;
  inviterName: string;
  token: string;
  code: string;
};
const sent: SentInvite[] = [];
mock.module("./team-emails.server", () => ({
  sendTeamInvite: async (params: SentInvite) => {
    sent.push(params);
  },
}));

/* -------------------------------------------------------------------------- */
/* Same small, stateful, in-memory Supabase-shaped fake as                    */
/* competition-recap.server.test.ts, plus `count` on head selects and an      */
/* `rpc` hook for the public lookup throttle.                                 */
/* -------------------------------------------------------------------------- */

type Row = Record<string, any>;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `row_${idCounter}`;
}

function fakeAdmin(seed: Record<string, Row[]>, rpcResult: unknown = 0) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const inserted: Record<string, Row[]> = {};
  const rpcCalls: { fn: string; args: Row }[] = [];

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
      then: (
        resolve: (v: { data: Row[]; error: null; count: number }) => unknown,
        reject?: unknown,
      ) => {
        const rows = execute();
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(
          resolve,
          reject as never,
        );
      },
    };
    return api;
  }

  const admin = {
    from: (table: string) => builder(table, [], "select", null, undefined, []),
    rpc: async (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      return { data: rpcResult, error: null };
    },
  } as unknown as ApiContext["admin"];
  return { admin, inserted, tables, rpcCalls };
}

/* ------------------------------------------------------------------ seeds */

const FUTURE = new Date(Date.now() + 10 * 86400_000).toISOString();
const PAST = new Date(Date.now() - 86400_000).toISOString();

const PAYER = {
  id: "p1",
  user_id: "payer-u",
  first_name: "Pat",
  last_name: "Lee",
  subscription_status: "active",
  current_period_end: FUTURE,
};
const CO = {
  id: "p2",
  user_id: "co-u",
  first_name: "Sam",
  last_name: "Rivera",
  subscription_status: null,
  current_period_end: null,
};
const OTHER = {
  id: "p3",
  user_id: "other-u",
  first_name: "Ola",
  last_name: "Nkemelu",
  subscription_status: null,
  current_period_end: null,
};
const ATHLETE = {
  id: "a1",
  parent_id: PAYER.id,
  first_name: "Ava",
  last_name: "Lee",
  created_at: "2026-01-01T00:00:00Z",
};
// `athletes` is the embedded-select shape guardianAthleteAccess reads (this
// fake's `select()` is a no-op, so the join must be baked into the seed row
// itself, same as other embeds elsewhere in this file's fakes).
const PRIMARY_LINK = {
  id: "g-primary",
  athlete_id: ATHLETE.id,
  parent_id: PAYER.id,
  role: "primary",
  created_at: "2026-01-01T00:00:00Z",
  athletes: { parent_id: ATHLETE.parent_id },
};
const CO_LINK = {
  id: "g-co",
  athlete_id: ATHLETE.id,
  parent_id: CO.id,
  role: "co",
  created_at: "2026-01-02T00:00:00Z",
  athletes: { parent_id: ATHLETE.parent_id },
};
const PENDING = {
  id: "inv1",
  athlete_id: ATHLETE.id,
  invited_by_parent_id: PAYER.id,
  email: "grandma@example.com",
  code: "ABCD2345",
  token: "t".repeat(48),
  status: "pending",
  created_at: "2026-01-03T00:00:00Z",
  expires_at: FUTURE,
};

function seedTeam(): Record<string, Row[]> {
  return {
    parent_profiles: [PAYER, CO, OTHER],
    athletes: [ATHLETE],
    athlete_guardians: [PRIMARY_LINK, CO_LINK],
    guardian_invites: [PENDING],
  };
}

/* ----------------------------------------------------------------- list */

describe("listTeamGuardians", () => {
  it("403 wrong_role for a caller with no parent profile", async () => {
    const { admin } = fakeAdmin(seedTeam());
    await expect(listTeamGuardians(admin, "coach-u")).rejects.toMatchObject({
      code: "wrong_role",
      status: 403,
    });
  });

  it("the payer sees guardians (primary first) and pending invites", async () => {
    const { admin } = fakeAdmin(seedTeam());
    expect(await listTeamGuardians(admin, PAYER.user_id, { apiContract: true })).toEqual({
      planActive: true,
      isPayer: true,
      athletes: [
        {
          id: "a1",
          firstName: "Ava",
          lastName: "Lee",
          isPrimary: true,
          locked: false,
          guardians: [
            { id: "g-primary", parentId: "p1", name: "Pat Lee", role: "primary", isSelf: true },
            { id: "g-co", parentId: "p2", name: "Sam Rivera", role: "co", isSelf: false },
          ],
          invites: [
            {
              id: "inv1",
              email: "grandma@example.com",
              code: "ABCD2345",
              createdAt: "2026-01-03T00:00:00Z",
              expiresAt: FUTURE,
            },
          ],
        },
      ],
    });
  });

  it("a covered co-guardian is planActive but not the payer; the API withholds invites (D6), the web keeps them", async () => {
    const { admin } = fakeAdmin(seedTeam());
    const api = await listTeamGuardians(admin, CO.user_id, { apiContract: true });
    expect(api.planActive).toBe(true);
    expect(api.isPayer).toBe(false);
    expect(api.athletes[0].isPrimary).toBe(false);
    expect(api.athletes[0].guardians).toHaveLength(2);
    expect(api.athletes[0].guardians[1].isSelf).toBe(true);
    expect(api.athletes[0].invites).toEqual([]);

    const web = await listTeamGuardians(admin, CO.user_id);
    expect(web.athletes[0].invites).toHaveLength(1);
    expect(web.athletes[0].invites[0].code).toBe("ABCD2345");
  });

  it("a co-guardian's athlete is locked, with no guardians or invites listed, once the primary's plan lapses", async () => {
    const seed = seedTeam();
    seed.parent_profiles = [
      { ...PAYER, subscription_status: null, current_period_end: null },
      CO,
      OTHER,
    ];
    const { admin } = fakeAdmin(seed);
    const out = await listTeamGuardians(admin, CO.user_id, { apiContract: true });
    expect(out.athletes).toEqual([
      {
        id: "a1",
        firstName: "Ava",
        lastName: "Lee",
        isPrimary: false,
        locked: true,
        guardians: [],
        invites: [],
      },
    ]);
  });

  it("no plan anywhere → planActive false; a parent with no athletes gets an empty list", async () => {
    const seed = seedTeam();
    seed.parent_profiles = [
      { ...PAYER, subscription_status: null, current_period_end: null },
      CO,
      OTHER,
    ];
    const { admin } = fakeAdmin(seed);
    const out = await listTeamGuardians(admin, CO.user_id, { apiContract: true });
    expect(out.planActive).toBe(false);
    expect(out.isPayer).toBe(false);

    const lonely = await listTeamGuardians(admin, OTHER.user_id, { apiContract: true });
    expect(lonely).toEqual({ planActive: false, isPayer: false, athletes: [] });
  });

  it("an expired pending invite is still listed (parity)", async () => {
    const seed = seedTeam();
    seed.guardian_invites = [{ ...PENDING, expires_at: PAST }];
    const { admin } = fakeAdmin(seed);
    const out = await listTeamGuardians(admin, PAYER.user_id, { apiContract: true });
    expect(out.athletes[0].invites[0].expiresAt).toBe(PAST);
  });
});

/* --------------------------------------------------------------- invite */

describe("inviteGuardian", () => {
  it("creates a pending invite with a code and token, and emails it when an address is given", async () => {
    sent.length = 0;
    const seed = seedTeam();
    seed.athlete_guardians = [PRIMARY_LINK];
    seed.guardian_invites = [];
    const { admin, inserted } = fakeAdmin(seed);
    const before = Date.now();
    const out = await inviteGuardian(admin, PAYER.user_id, {
      athleteId: "a1",
      email: "coparent@example.com",
    });
    expect(out.ok).toBe(true);
    expect(out.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(out.token).toMatch(/^[0-9a-f]{48}$/);
    const row = inserted.guardian_invites[0];
    expect(out.inviteId).toBe(row.id);
    expect(row).toMatchObject({
      athlete_id: "a1",
      invited_by_parent_id: "p1",
      email: "coparent@example.com",
      status: "pending",
      code: out.code,
      token: out.token,
    });
    const ttl = new Date(row.expires_at).getTime() - before;
    expect(ttl).toBeGreaterThan((INVITE_TTL_DAYS - 1) * 86400_000);
    expect(ttl).toBeLessThanOrEqual(INVITE_TTL_DAYS * 86400_000 + 5000);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("coparent@example.com");
    expect(sent[0].token).toBe(out.token);
    expect(sent[0].code).toBe(out.code);
  });

  it("sends nothing when no email is given", async () => {
    sent.length = 0;
    const seed = seedTeam();
    seed.athlete_guardians = [PRIMARY_LINK];
    seed.guardian_invites = [];
    const { admin } = fakeAdmin(seed);
    const out = await inviteGuardian(admin, PAYER.user_id, { athleteId: "a1", email: null });
    expect(out.ok).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("403 wrong_role without a parent profile", async () => {
    const { admin } = fakeAdmin(seedTeam());
    await expect(inviteGuardian(admin, "nobody", { athleteId: "a1" })).rejects.toMatchObject({
      code: "wrong_role",
      status: 403,
    });
  });

  it("403 forbidden for a co-guardian or an unowned athlete", async () => {
    const { admin } = fakeAdmin(seedTeam());
    await expect(inviteGuardian(admin, CO.user_id, { athleteId: "a1" })).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
      message: "Only the primary parent can manage guardians for this athlete.",
    });
    await expect(
      inviteGuardian(admin, PAYER.user_id, { athleteId: "00000000-0000-0000-0000-000000000009" }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("403 plan_required when the caller has no active Team plan", async () => {
    const seed = seedTeam();
    seed.parent_profiles = [
      { ...PAYER, subscription_status: "canceled", current_period_end: PAST },
    ];
    const { admin } = fakeAdmin(seed);
    await expect(inviteGuardian(admin, PAYER.user_id, { athleteId: "a1" })).rejects.toMatchObject({
      code: "plan_required",
      status: 403,
      message: "Start the Team plan to add another parent or guardian.",
    });
  });

  it("409 conflict at the seat cap — pending invites count as seats", async () => {
    // primary + co + one pending = 3
    const { admin } = fakeAdmin(seedTeam());
    await expect(inviteGuardian(admin, PAYER.user_id, { athleteId: "a1" })).rejects.toMatchObject({
      code: "conflict",
      status: 409,
      message:
        "The Team plan allows up to 3 guardians per athlete. Remove a guardian or revoke a pending invite first.",
    });
  });
});

/* --------------------------------------------------------------- resend */

describe("resendTeamGuardianInvite", () => {
  it("re-sends the same code and token to the invite's email", async () => {
    sent.length = 0;
    const { admin, tables } = fakeAdmin(seedTeam());
    expect(await resendTeamGuardianInvite(admin, PAYER.user_id, { inviteId: "inv1" })).toEqual({
      ok: true,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      to: "grandma@example.com",
      athleteName: "Ava Lee",
      inviterName: "Pat Lee",
      token: PENDING.token,
      code: "ABCD2345",
    });
    // Not expired → untouched.
    expect(tables.guardian_invites[0].expires_at).toBe(FUTURE);
  });

  it("extends an already-expired invite before re-sending", async () => {
    sent.length = 0;
    const seed = seedTeam();
    seed.guardian_invites = [{ ...PENDING, expires_at: PAST }];
    const { admin, tables } = fakeAdmin(seed);
    await resendTeamGuardianInvite(admin, PAYER.user_id, { inviteId: "inv1" });
    const ttl = new Date(tables.guardian_invites[0].expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan((INVITE_TTL_DAYS - 1) * 86400_000);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("grandma@example.com");
  });

  it("422 unprocessable when the invite has no email on file", async () => {
    sent.length = 0;
    const seed = seedTeam();
    seed.guardian_invites = [{ ...PENDING, email: null }];
    const { admin } = fakeAdmin(seed);
    await expect(
      resendTeamGuardianInvite(admin, PAYER.user_id, { inviteId: "inv1" }),
    ).rejects.toMatchObject({
      code: "unprocessable",
      status: 422,
      message: "This invite has no email on file — share the code instead.",
    });
    expect(sent).toHaveLength(0);
  });

  it("404 for another parent's invite, a non-pending one, or an unknown id; 403 wrong_role without a profile", async () => {
    sent.length = 0;
    const seed = seedTeam();
    seed.guardian_invites = [PENDING, { ...PENDING, id: "inv2", status: "claimed" }];
    const { admin } = fakeAdmin(seed);
    await expect(
      resendTeamGuardianInvite(admin, CO.user_id, { inviteId: "inv1" }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      resendTeamGuardianInvite(admin, PAYER.user_id, { inviteId: "inv2" }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      resendTeamGuardianInvite(admin, PAYER.user_id, { inviteId: "nope" }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      resendTeamGuardianInvite(admin, "nobody", { inviteId: "inv1" }),
    ).rejects.toMatchObject({ code: "wrong_role", status: 403 });
    expect(sent).toHaveLength(0);
  });
});

/* --------------------------------------------------------------- revoke */

describe("revokeGuardianInvite", () => {
  it("marks the caller's pending invite revoked", async () => {
    const { admin, tables } = fakeAdmin(seedTeam());
    expect(
      await revokeGuardianInvite(admin, PAYER.user_id, { inviteId: "inv1" }, { apiContract: true }),
    ).toEqual({ ok: true });
    expect(tables.guardian_invites[0].status).toBe("revoked");
  });

  it("another parent's invite: 404 on the API, silent ok on the web, row untouched either way", async () => {
    const { admin, tables } = fakeAdmin(seedTeam());
    await expect(
      revokeGuardianInvite(admin, CO.user_id, { inviteId: "inv1" }, { apiContract: true }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(await revokeGuardianInvite(admin, CO.user_id, { inviteId: "inv1" })).toEqual({
      ok: true,
    });
    expect(tables.guardian_invites[0].status).toBe("pending");
  });

  it("an already-claimed invite is 404 on the API", async () => {
    const seed = seedTeam();
    seed.guardian_invites = [{ ...PENDING, status: "claimed" }];
    const { admin } = fakeAdmin(seed);
    await expect(
      revokeGuardianInvite(admin, PAYER.user_id, { inviteId: "inv1" }, { apiContract: true }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("403 wrong_role without a parent profile", async () => {
    const { admin } = fakeAdmin(seedTeam());
    await expect(
      revokeGuardianInvite(admin, "nobody", { inviteId: "inv1" }, { apiContract: true }),
    ).rejects.toMatchObject({ code: "wrong_role", status: 403 });
  });
});

/* --------------------------------------------- remove (web shape, by pair) */

describe("removeGuardian", () => {
  it("the primary removes a co-guardian", async () => {
    const { admin, tables } = fakeAdmin(seedTeam());
    expect(await removeGuardian(admin, PAYER.user_id, { athleteId: "a1", parentId: "p2" })).toEqual(
      { ok: true },
    );
    expect(tables.athlete_guardians.map((g) => g.id)).toEqual(["g-primary"]);
  });

  it("a co-guardian may remove themselves but nobody else", async () => {
    const { admin, tables } = fakeAdmin(seedTeam());
    await expect(
      removeGuardian(admin, CO.user_id, { athleteId: "a1", parentId: "p1" }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(await removeGuardian(admin, CO.user_id, { athleteId: "a1", parentId: "p2" })).toEqual({
      ok: true,
    });
    expect(tables.athlete_guardians.map((g) => g.id)).toEqual(["g-primary"]);
  });

  it("the primary row is never deleted (self-removal is a no-op)", async () => {
    const { admin, tables } = fakeAdmin(seedTeam());
    expect(await removeGuardian(admin, PAYER.user_id, { athleteId: "a1", parentId: "p1" })).toEqual(
      { ok: true },
    );
    expect(tables.athlete_guardians).toHaveLength(2);
  });
});

/* ------------------------------------------------- remove (API shape, by id) */

describe("removeGuardianById", () => {
  it("the primary removes a co-guardian by row id", async () => {
    const { admin, tables } = fakeAdmin(seedTeam());
    expect(
      await removeGuardianById(admin, PAYER.user_id, { guardianId: "g-co" }, { apiContract: true }),
    ).toEqual({ ok: true });
    expect(tables.athlete_guardians.map((g) => g.id)).toEqual(["g-primary"]);
  });

  it("a co-guardian may remove themselves", async () => {
    const { admin, tables } = fakeAdmin(seedTeam());
    expect(
      await removeGuardianById(admin, CO.user_id, { guardianId: "g-co" }, { apiContract: true }),
    ).toEqual({ ok: true });
    expect(tables.athlete_guardians.map((g) => g.id)).toEqual(["g-primary"]);
  });

  it("403 forbidden when another co-guardian tries", async () => {
    const seed = seedTeam();
    seed.athlete_guardians = [
      PRIMARY_LINK,
      CO_LINK,
      {
        id: "g-other",
        athlete_id: "a1",
        parent_id: OTHER.id,
        role: "co",
        created_at: "2026-01-03",
      },
    ];
    const { admin, tables } = fakeAdmin(seed);
    await expect(
      removeGuardianById(admin, OTHER.user_id, { guardianId: "g-co" }, { apiContract: true }),
    ).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
      message: "Only the primary parent can manage guardians for this athlete.",
    });
    expect(tables.athlete_guardians).toHaveLength(3);
  });

  it("the primary row and unknown ids are 404 on the API, silent ok on the web", async () => {
    const { admin, tables } = fakeAdmin(seedTeam());
    await expect(
      removeGuardianById(admin, PAYER.user_id, { guardianId: "g-primary" }, { apiContract: true }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      removeGuardianById(admin, PAYER.user_id, { guardianId: "nope" }, { apiContract: true }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(await removeGuardianById(admin, PAYER.user_id, { guardianId: "g-primary" })).toEqual({
      ok: true,
    });
    expect(tables.athlete_guardians).toHaveLength(2);
  });

  it("403 wrong_role without a parent profile", async () => {
    const { admin } = fakeAdmin(seedTeam());
    await expect(
      removeGuardianById(admin, "nobody", { guardianId: "g-co" }, { apiContract: true }),
    ).rejects.toMatchObject({ code: "wrong_role", status: 403 });
  });
});

/* -------------------------------------------------------------- preview */

describe("previewGuardianInvite", () => {
  it("finds a pending invite by token, and by code case-insensitively", async () => {
    const { admin } = fakeAdmin(seedTeam());
    expect(await previewGuardianInvite(admin, null, { token: PENDING.token })).toEqual({
      found: true,
      athleteName: "Ava Lee",
      inviterName: "Pat Lee",
    });
    expect(await previewGuardianInvite(admin, null, { code: "abcd2345" })).toEqual({
      found: true,
      athleteName: "Ava Lee",
      inviterName: "Pat Lee",
    });
  });

  it("unknown, used, and expired invites all answer found:false with null names", async () => {
    const seed = seedTeam();
    seed.guardian_invites = [
      PENDING,
      { ...PENDING, id: "inv2", token: "u".repeat(48), code: "USED0000", status: "claimed" },
      { ...PENDING, id: "inv3", token: "e".repeat(48), code: "EXPD0000", expires_at: PAST },
    ];
    const { admin } = fakeAdmin(seed);
    const none = { found: false, athleteName: null, inviterName: null };
    expect(await previewGuardianInvite(admin, null, { token: "x".repeat(48) })).toEqual(none);
    expect(await previewGuardianInvite(admin, null, { token: "u".repeat(48) })).toEqual(none);
    expect(await previewGuardianInvite(admin, null, { token: "e".repeat(48) })).toEqual(none);
    expect(await previewGuardianInvite(admin, null, { code: "EXPD0000" })).toEqual(none);
  });

  it("falls back to generic names when the athlete or inviter row is gone", async () => {
    const seed = seedTeam();
    seed.athletes = [];
    seed.parent_profiles = [];
    const { admin } = fakeAdmin(seed);
    expect(await previewGuardianInvite(admin, null, { token: PENDING.token })).toEqual({
      found: true,
      athleteName: "an athlete",
      inviterName: "A parent",
    });
  });

  it("400 validation_failed when neither token nor code is given", async () => {
    const { admin } = fakeAdmin(seedTeam());
    await expect(previewGuardianInvite(admin, null, {})).rejects.toMatchObject({
      code: "validation_failed",
      status: 400,
      message: "Missing invite.",
    });
  });

  it("with an IP key, records a lookup attempt under a constant key (never the token) and 429s when exhausted", async () => {
    const ok = fakeAdmin(seedTeam(), 1);
    await previewGuardianInvite(ok.admin, "203.0.113.9", { token: PENDING.token });
    expect(ok.rpcCalls).toHaveLength(1);
    expect(ok.rpcCalls[0].fn).toBe("record_invite_lookup_attempt");
    expect(ok.rpcCalls[0].args._ip).toBe("203.0.113.9");
    expect(ok.rpcCalls[0].args._code).toBe("team-invite");
    expect(JSON.stringify(ok.rpcCalls)).not.toContain(PENDING.token);

    const exhausted = fakeAdmin(seedTeam(), -1);
    await expect(
      previewGuardianInvite(exhausted.admin, "203.0.113.9", { token: PENDING.token }),
    ).rejects.toMatchObject({ code: "rate_limited", status: 429 });

    // The web wrapper passes no key: no attempt is recorded.
    const web = fakeAdmin(seedTeam(), -1);
    expect((await previewGuardianInvite(web.admin, null, { token: PENDING.token })).found).toBe(
      true,
    );
    expect(web.rpcCalls).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------- claim */

describe("claimGuardianInvite", () => {
  it("links an existing parent as a co-guardian and marks the invite claimed", async () => {
    const seed = seedTeam();
    seed.athlete_guardians = [PRIMARY_LINK];
    const { admin, tables } = fakeAdmin(seed);
    expect(await claimGuardianInvite(admin, CO.user_id, null, { token: PENDING.token })).toEqual({
      ok: true,
      athleteId: "a1",
    });
    expect(tables.athlete_guardians).toHaveLength(2);
    expect(tables.athlete_guardians[1]).toMatchObject({
      athlete_id: "a1",
      parent_id: "p2",
      role: "co",
    });
    expect(tables.guardian_invites[0]).toMatchObject({ status: "claimed", claimed_by: "p2" });
    expect(tables.guardian_invites[0].claimed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // No profile was created for a caller who already had one.
    expect(tables.parent_profiles).toHaveLength(3);
  });

  it("claims by code case-insensitively", async () => {
    const seed = seedTeam();
    seed.athlete_guardians = [PRIMARY_LINK];
    const { admin } = fakeAdmin(seed);
    expect(await claimGuardianInvite(admin, CO.user_id, null, { code: "abcd2345" })).toEqual({
      ok: true,
      athleteId: "a1",
    });
  });

  it("creates a parent profile from the display name for a caller without one (parity: any role)", async () => {
    const seed = seedTeam();
    seed.athlete_guardians = [PRIMARY_LINK];
    const { admin, inserted } = fakeAdmin(seed);
    await claimGuardianInvite(admin, "new-u", "Jordan Q Public", { token: PENDING.token });
    expect(inserted.parent_profiles[0]).toMatchObject({
      user_id: "new-u",
      first_name: "Jordan",
      last_name: "Q Public",
    });

    const second = fakeAdmin(seed);
    await claimGuardianInvite(second.admin, "new-u2", null, { token: PENDING.token });
    expect(second.inserted.parent_profiles[0]).toMatchObject({
      user_id: "new-u2",
      first_name: "Parent",
      last_name: "",
    });
  });

  it("400 when neither token nor code; 404 for an unknown or used invite; 409 when expired", async () => {
    const seed = seedTeam();
    seed.guardian_invites = [
      PENDING,
      { ...PENDING, id: "inv2", token: "u".repeat(48), code: "USED0000", status: "claimed" },
      { ...PENDING, id: "inv3", token: "e".repeat(48), code: "EXPD0000", expires_at: PAST },
    ];
    const { admin } = fakeAdmin(seed);
    await expect(claimGuardianInvite(admin, CO.user_id, null, {})).rejects.toMatchObject({
      code: "validation_failed",
      status: 400,
    });
    await expect(
      claimGuardianInvite(admin, CO.user_id, null, { token: "x".repeat(48) }),
    ).rejects.toMatchObject({
      code: "not_found",
      status: 404,
      message: "That invite is no longer valid.",
    });
    await expect(
      claimGuardianInvite(admin, CO.user_id, null, { token: "u".repeat(48) }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      claimGuardianInvite(admin, CO.user_id, null, { token: "e".repeat(48) }),
    ).rejects.toMatchObject({
      code: "conflict",
      status: 409,
      message: "That invite has expired. Ask them to send a new one.",
    });
  });

  it("409 conflict when the claimer is the athlete's primary parent", async () => {
    const { admin } = fakeAdmin(seedTeam());
    await expect(
      claimGuardianInvite(admin, PAYER.user_id, null, { token: PENDING.token }),
    ).rejects.toMatchObject({
      code: "conflict",
      status: 409,
      message: "You're already the primary parent for this athlete.",
    });
  });

  it("409 conflict at the seat cap (linked guardians only — pending invites don't count here)", async () => {
    const seed = seedTeam();
    seed.athlete_guardians = [
      PRIMARY_LINK,
      CO_LINK,
      {
        id: "g-other",
        athlete_id: "a1",
        parent_id: OTHER.id,
        role: "co",
        created_at: "2026-01-03",
      },
    ];
    seed.parent_profiles = [
      PAYER,
      CO,
      OTHER,
      {
        id: "p4",
        user_id: "fourth-u",
        first_name: "Kai",
        last_name: "Sato",
        subscription_status: null,
        current_period_end: null,
      },
    ];
    const { admin, tables } = fakeAdmin(seed);
    await expect(
      claimGuardianInvite(admin, "fourth-u", null, { token: PENDING.token }),
    ).rejects.toMatchObject({
      code: "conflict",
      status: 409,
      message: "This athlete already has the maximum of 3 guardians.",
    });
    expect(tables.guardian_invites[0].status).toBe("pending");
  });

  it("an already-linked co-guardian re-claiming is not capped and stays a single link", async () => {
    const seed = seedTeam();
    seed.athlete_guardians = [
      PRIMARY_LINK,
      CO_LINK,
      {
        id: "g-other",
        athlete_id: "a1",
        parent_id: OTHER.id,
        role: "co",
        created_at: "2026-01-03",
      },
    ];
    const { admin, tables } = fakeAdmin(seed);
    expect(await claimGuardianInvite(admin, CO.user_id, null, { token: PENDING.token })).toEqual({
      ok: true,
      athleteId: "a1",
    });
    expect(tables.athlete_guardians).toHaveLength(3);
    expect(tables.guardian_invites[0].status).toBe("claimed");
  });
});
