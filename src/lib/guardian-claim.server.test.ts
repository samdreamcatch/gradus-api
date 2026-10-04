import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import type { ApiContext } from "./api/auth";
import { createApiRouteHandler } from "./api/define-route";
import { ApiError } from "./api/errors";
import {
  claimAthleteSelf,
  claimGuardianAthlete,
  getGuardianClaimContext,
  getGuardianClaimMergeOptions,
  getGuardianClaimSummary,
  getMyGuardianStatus,
  isMinorConservative,
  mergeGuardianClaim,
  resendGuardianInvite,
  resendGuardianInviteBodyInput,
} from "./guardian-claim.server";

/* -------------------------------------------------------------------------- */
/* Same small, stateful, in-memory Supabase-shaped fake as                    */
/* competition-recap.server.test.ts, plus `rpc` and an update-error injector.  */
/* -------------------------------------------------------------------------- */

type Row = Record<string, any>;
type Admin = Parameters<typeof getGuardianClaimContext>[0];

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `row_${idCounter}`;
}

type RpcCall = { name: string; args: Record<string, unknown> };

/**
 * `updateError` makes every `.update()` on that table fail with the given
 * Postgres-shaped error without touching the rows — stands in for a trigger
 * or CHECK refusal.
 */
function fakeAdmin(
  seed: Record<string, Row[]>,
  opts: { rpcResult?: unknown; updateError?: { table: string; error: Row } } = {},
) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const inserted: Record<string, Row[]> = {};
  const rpcCalls: RpcCall[] = [];

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
      upsert: (row: Row | Row[], o?: { onConflict?: string }) =>
        builder(table, filters, "upsert", row, o?.onConflict, order, limitN),
      update: (patch: Row) => builder(table, filters, "update", patch, onConflict, order, limitN),
      delete: () => builder(table, filters, "delete", null, onConflict, order, limitN),
      maybeSingle: async () => ({ data: execute()[0] ?? null, error: null }),
      single: async () => ({ data: execute()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: Row | null }) => unknown, reject?: unknown) => {
        if (mode === "update" && opts.updateError?.table === table) {
          return Promise.resolve({ data: [], error: opts.updateError.error }).then(
            resolve,
            reject as never,
          );
        }
        return Promise.resolve({ data: execute(), error: null }).then(resolve, reject as never);
      },
    };
    return api;
  }

  const admin = {
    from: (table: string) => builder(table, [], "select", null, undefined, []),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: opts.rpcResult ?? 1, error: null };
    },
  } as unknown as Admin;

  return { admin, inserted, tables, rpcCalls };
}

/* ------------------------------------------------------------- email mock */

type SentInvite = {
  to: string;
  athleteName: string;
  coachName?: string | null;
  token: string;
  recipient?: "guardian" | "athlete";
};
const MINTED = "b".repeat(48);

/** Fakes the never-throwing email helpers for one test; restores the real module after. */
async function withEmailMock<T>(run: (sent: SentInvite[]) => Promise<T>): Promise<T> {
  const real = await import("./guardian.server");
  const sent: SentInvite[] = [];
  mock.module("./guardian.server", () => ({
    ...real,
    newGuardianToken: () => MINTED,
    sendGuardianInvite: async (p: SentInvite) => {
      sent.push(p);
    },
  }));
  try {
    return await run(sent);
  } finally {
    mock.module("./guardian.server", () => real);
  }
}

/* ---------------------------------------------------------------- fixtures */

const TOKEN = "a".repeat(48);
const USER = "user-1";
const OTHER_USER = "user-2";
const ATHLETE_ID = "11111111-1111-4111-8111-111111111111";
const MINE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ATHLETE_ID = "33333333-3333-4333-8333-333333333333";

const COACH = { id: "coach-1", user_id: "coach-u", first_name: "Sam", last_name: "Ortiz" };
const PARENT = { id: "parent-1", user_id: USER, first_name: "Corin", last_name: "Abbott" };
const OTHER_PARENT = { id: "parent-2", user_id: OTHER_USER, first_name: "Jo", last_name: "Ng" };

function pendingAthlete(over: Row = {}): Row {
  return {
    id: ATHLETE_ID,
    first_name: "Leo",
    last_name: "Abbott",
    birthdate: "2014-05-01",
    parent_id: null,
    user_id: null,
    self_managed: false,
    guardian_email: "guardian@example.com",
    guardian_claim_token: TOKEN,
    guardian_claimed_at: null,
    guardian_invited_at: "2026-09-01T00:00:00.000Z",
    added_by_coach_id: COACH.id,
    invite_recipient: "guardian",
    ...over,
  };
}

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ================================================================ summary */

describe("getGuardianClaimSummary", () => {
  it("returns the claim page's summary with the adding coach's name", async () => {
    const { admin } = fakeAdmin({ athletes: [pendingAthlete()], coach_profiles: [COACH] });
    const out = await getGuardianClaimSummary(admin, { token: TOKEN });
    expect(out).toEqual({
      athleteFirstName: "Leo",
      athleteLastName: "Abbott",
      coachName: "Sam Ortiz",
      needsBirthdate: false,
      inviteRecipient: "guardian",
      alreadyClaimed: false,
    });
  });

  it("defaults a NULL invite_recipient to guardian, reports a missing birthdate and a claimed row", async () => {
    const { admin } = fakeAdmin({
      athletes: [
        pendingAthlete({
          invite_recipient: null,
          birthdate: null,
          added_by_coach_id: null,
          parent_id: "someone",
        }),
      ],
    });
    const out = await getGuardianClaimSummary(admin, { token: TOKEN });
    expect(out).toEqual({
      athleteFirstName: "Leo",
      athleteLastName: "Abbott",
      coachName: null,
      needsBirthdate: true,
      inviteRecipient: "guardian",
      alreadyClaimed: true,
    });
  });

  it("surfaces an athlete-addressed invite", async () => {
    const { admin } = fakeAdmin({ athletes: [pendingAthlete({ invite_recipient: "athlete" })] });
    const out = await getGuardianClaimSummary(admin, { token: TOKEN });
    expect(out.inviteRecipient).toBe("athlete");
  });

  it("404s an unknown token", async () => {
    const { admin } = fakeAdmin({ athletes: [pendingAthlete()] });
    await expect(getGuardianClaimSummary(admin, { token: "c".repeat(48) })).rejects.toMatchObject({
      code: "not_found",
      status: 404,
      message: "This link is no longer valid. Ask the coach to resend it.",
    });
  });

  it("never consumes the shared invite-lookup window — the route limiter alone throttles it", async () => {
    const { admin, rpcCalls } = fakeAdmin({ athletes: [pendingAthlete()] });
    await getGuardianClaimSummary(admin, { token: TOKEN });
    expect(rpcCalls).toHaveLength(0);
  });
});

/* ================================================================== claim */

describe("claimGuardianAthlete", () => {
  it("activates the athlete and records consent on the claim (PRD §6.13 A3–A4)", async () => {
    const { admin, tables } = fakeAdmin({
      athletes: [pendingAthlete({ account_state: "provisional", user_id: "teen-user" })],
      parent_profiles: [PARENT],
      guardian_consents: [],
    });
    await claimGuardianAthlete(admin, USER, { token: TOKEN });
    const athlete = tables.athletes[0];
    expect(athlete.account_state).toBe("active");
    expect(athlete.parent_id).toBe(PARENT.id);
    const consents = tables.guardian_consents ?? [];
    expect(consents.map((c: Record<string, unknown>) => c.scope).sort()).toEqual([
      "account",
      "messaging",
    ]);
    expect(consents.every((c: Record<string, unknown>) => c.method === "guardian_claim")).toBe(
      true,
    );
  });

  it("refuses an athlete paused by Apple's RESCIND_CONSENT and leaves the pause in place (PRD §6.13 B4)", async () => {
    const { admin, tables } = fakeAdmin({
      athletes: [pendingAthlete({ account_state: "paused", user_id: "teen-user" })],
      parent_profiles: [PARENT],
      guardian_consents: [],
    });
    await expect(claimGuardianAthlete(admin, USER, { token: TOKEN })).rejects.toMatchObject({
      code: "paused",
      status: 403,
    });
    expect(tables.athletes[0].account_state).toBe("paused");
    expect(tables.athletes[0].parent_id ?? null).toBeNull();
    expect(tables.guardian_consents ?? []).toHaveLength(0);
  });

  it("with the regime switch on, an unverified parent is refused with parent_unverified", async () => {
    const previous = process.env.PARENT_VERIFICATION_REQUIRED;
    process.env.PARENT_VERIFICATION_REQUIRED = "true";
    try {
      const { admin, tables } = fakeAdmin({
        athletes: [pendingAthlete()],
        parent_profiles: [{ ...PARENT, adult_verified_at: null, adult_verification_method: null }],
        guardian_consents: [],
      });
      await expect(claimGuardianAthlete(admin, USER, { token: TOKEN })).rejects.toMatchObject({
        code: "parent_unverified",
        status: 403,
      });
      expect(tables.athletes[0].parent_id).toBeNull();

      const verified = fakeAdmin({
        athletes: [pendingAthlete()],
        parent_profiles: [
          {
            ...PARENT,
            adult_verified_at: "2026-01-01T00:00:00Z",
            adult_verification_method: "legacy",
          },
        ],
        guardian_consents: [],
      });
      await claimGuardianAthlete(verified.admin, USER, { token: TOKEN });
      expect(verified.tables.athletes[0].parent_id).toBe(PARENT.id);
    } finally {
      if (previous === undefined) delete process.env.PARENT_VERIFICATION_REQUIRED;
      else process.env.PARENT_VERIFICATION_REQUIRED = previous;
    }
  });

  it("creates the parent profile and links the athlete (first claim)", async () => {
    const { admin, tables, inserted } = fakeAdmin({ athletes: [pendingAthlete()] });
    const out = await claimGuardianAthlete(admin, USER, {
      token: TOKEN,
      firstName: "Corin",
      lastName: "Abbott",
    });
    expect(out).toEqual({ ok: true, athleteFirstName: "Leo" });
    expect(inserted.parent_profiles).toEqual([
      { id: expect.stringMatching(/^row_/), user_id: USER, first_name: "Corin", last_name: "Abbott" },
    ]);
    const athlete = tables.athletes![0]!;
    expect(athlete.parent_id).toBe(inserted.parent_profiles![0]!.id);
    expect(athlete.guardian_claim_token).toBeNull();
    expect(typeof athlete.guardian_claimed_at).toBe("string");
    expect(athlete.birthdate).toBe("2014-05-01");
    expect(athlete.self_managed).toBe(false);
  });

  it("names a first-time parent 'Parent' when no names are given", async () => {
    const { admin, inserted } = fakeAdmin({ athletes: [pendingAthlete()] });
    await claimGuardianAthlete(admin, USER, { token: TOKEN });
    expect(inserted.parent_profiles![0]).toMatchObject({ first_name: "Parent", last_name: "" });
  });

  it("fills a missing birthdate from the claimer and updates a returning parent's names", async () => {
    const { admin, tables, inserted } = fakeAdmin({
      athletes: [pendingAthlete({ birthdate: null })],
      parent_profiles: [PARENT],
    });
    await claimGuardianAthlete(admin, USER, {
      token: TOKEN,
      firstName: "Corinne",
      lastName: "Abbott",
      birthdate: "2015-02-03",
    });
    expect(inserted.parent_profiles).toBeUndefined();
    expect(tables.parent_profiles![0]).toMatchObject({ first_name: "Corinne", last_name: "Abbott" });
    expect(tables.athletes![0]).toMatchObject({ parent_id: PARENT.id, birthdate: "2015-02-03" });
  });

  it("never overwrites a birthdate the row already has", async () => {
    const { admin, tables } = fakeAdmin({
      athletes: [pendingAthlete()],
      parent_profiles: [PARENT],
    });
    await claimGuardianAthlete(admin, USER, { token: TOKEN, birthdate: "2000-01-01" });
    expect(tables.athletes![0]!.birthdate).toBe("2014-05-01");
  });

  it("D3: un-self-manages a minor who signed up with a guardian email", async () => {
    const { admin, tables } = fakeAdmin({
      athletes: [pendingAthlete({ self_managed: true, user_id: "kid-u", added_by_coach_id: null })],
      parent_profiles: [PARENT],
    });
    await claimGuardianAthlete(admin, USER, { token: TOKEN });
    expect(tables.athletes![0]).toMatchObject({
      self_managed: false,
      parent_id: PARENT.id,
      user_id: "kid-u",
    });
  });

  it("404s an unknown token", async () => {
    const { admin } = fakeAdmin({ athletes: [pendingAthlete()] });
    await expect(
      claimGuardianAthlete(admin, USER, { token: "c".repeat(48) }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("422s when the row has no birthdate and none is supplied", async () => {
    const { admin } = fakeAdmin({ athletes: [pendingAthlete({ birthdate: null })] });
    await expect(claimGuardianAthlete(admin, USER, { token: TOKEN })).rejects.toMatchObject({
      code: "unprocessable",
      status: 422,
      message: "Enter the athlete's date of birth to finish setting up their account.",
    });
  });

  it("403 wrong_role for a coach account", async () => {
    const { admin, inserted } = fakeAdmin({
      athletes: [pendingAthlete()],
      coach_profiles: [COACH],
    });
    await expect(
      claimGuardianAthlete(admin, COACH.user_id, { token: TOKEN }),
    ).rejects.toMatchObject({
      code: "wrong_role",
      status: 403,
      message:
        "You're signed in as a coach. Sign out and use a personal email to claim this athlete.",
    });
    expect(inserted.parent_profiles).toBeUndefined();
  });

  it("D3: 409s a row linked to another parent BEFORE creating a parent profile", async () => {
    const { admin, inserted, tables } = fakeAdmin({
      athletes: [pendingAthlete({ parent_id: OTHER_PARENT.id })],
      parent_profiles: [OTHER_PARENT],
    });
    await expect(claimGuardianAthlete(admin, USER, { token: TOKEN })).rejects.toMatchObject({
      code: "conflict",
      status: 409,
      message: "This athlete is already linked to another parent account.",
    });
    expect(inserted.parent_profiles).toBeUndefined();
    expect(tables.athletes![0]!.guardian_claim_token).toBe(TOKEN);
  });

  it("lets the same parent re-claim a row already linked to them (parity)", async () => {
    const { admin, tables } = fakeAdmin({
      athletes: [pendingAthlete({ parent_id: PARENT.id })],
      parent_profiles: [PARENT],
    });
    const out = await claimGuardianAthlete(admin, USER, { token: TOKEN });
    expect(out.ok).toBe(true);
    expect(tables.athletes![0]!.guardian_claim_token).toBeNull();
  });

  it("refuses the athlete behind the link claiming themselves (web and API): 403, nothing written", async () => {
    for (const opts of [undefined, { apiContract: true }]) {
      const { admin, inserted, tables } = fakeAdmin({
        athletes: [pendingAthlete({ self_managed: true, user_id: USER, added_by_coach_id: null })],
      });
      await expect(claimGuardianAthlete(admin, USER, { token: TOKEN }, opts)).rejects.toMatchObject(
        {
          code: "forbidden",
          status: 403,
          message: "This link is for your parent or guardian — ask them to open it.",
        },
      );
      expect(inserted.parent_profiles).toBeUndefined();
      expect(tables.athletes![0]).toMatchObject({
        self_managed: true,
        parent_id: null,
        user_id: USER,
        guardian_claim_token: TOKEN,
        guardian_claimed_at: null,
      });
    }
  });

  it("API: a minor athlete account can't claim anyone else's link either (403 wrong_role)", async () => {
    for (const birthdate of [yearsAgo(15), null]) {
      const { admin, inserted, tables } = fakeAdmin({
        athletes: [
          pendingAthlete(),
          {
            id: MINE_ID,
            user_id: USER,
            first_name: "Kid",
            last_name: "Abbott",
            birthdate,
            self_managed: false,
            parent_id: OTHER_PARENT.id,
          },
        ],
      });
      await expect(
        claimGuardianAthlete(admin, USER, { token: TOKEN }, { apiContract: true }),
      ).rejects.toMatchObject({
        code: "wrong_role",
        status: 403,
        message:
          "You're signed in as an athlete under 18. Ask a parent or guardian to open this link.",
      });
      expect(inserted.parent_profiles).toBeUndefined();
      expect(tables.athletes![0]).toMatchObject({ parent_id: null, guardian_claim_token: TOKEN });
    }
  });

  it("an adult athlete account may still claim as a parent; the web keeps parity for a minor account", async () => {
    const adult = fakeAdmin({
      athletes: [
        pendingAthlete(),
        { id: MINE_ID, user_id: USER, first_name: "Me", last_name: "Abbott", birthdate: yearsAgo(30) },
      ],
    });
    const out = await claimGuardianAthlete(
      adult.admin,
      USER,
      { token: TOKEN },
      { apiContract: true },
    );
    expect(out.ok).toBe(true);
    expect(adult.tables.athletes![0]!.parent_id).toBe(adult.inserted.parent_profiles![0]!.id);

    const web = fakeAdmin({
      athletes: [
        pendingAthlete(),
        {
          id: MINE_ID,
          user_id: USER,
          first_name: "Kid",
          last_name: "Abbott",
          birthdate: yearsAgo(15),
        },
      ],
    });
    expect((await claimGuardianAthlete(web.admin, USER, { token: TOKEN })).ok).toBe(true);
  });
});

/* ================================================================= resend */

describe("resendGuardianInvite", () => {
  it("the athlete re-sends to the address on file, reusing the token and naming the coach", async () => {
    await withEmailMock(async (sent) => {
      const { admin, tables } = fakeAdmin({
        athletes: [pendingAthlete({ user_id: USER })],
        coach_profiles: [COACH],
      });
      const out = await resendGuardianInvite(admin, USER, { athleteId: ATHLETE_ID });
      expect(out).toEqual({ ok: true, guardianEmail: "guardian@example.com" });
      expect(sent).toEqual([
        {
          to: "guardian@example.com",
          athleteName: "Leo Abbott",
          coachName: "Sam Ortiz",
          token: TOKEN,
          recipient: "guardian",
        },
      ]);
      expect(tables.athletes![0]!.guardian_claim_token).toBe(TOKEN);
      expect(tables.athletes![0]!.guardian_invited_at).not.toBe("2026-09-01T00:00:00.000Z");
    });
  });

  it("refuses to re-send for an athlete paused by RESCIND_CONSENT", async () => {
    await withEmailMock(async (sent) => {
      const { admin } = fakeAdmin({
        athletes: [pendingAthlete({ user_id: USER, account_state: "paused" })],
        coach_profiles: [COACH],
      });
      await expect(
        resendGuardianInvite(admin, USER, {
          athleteId: ATHLETE_ID,
          guardianEmail: "me@example.com",
        }),
      ).rejects.toMatchObject({ code: "paused", status: 403 });
      expect(sent).toHaveLength(0);
    });
  });

  it("a new address replaces the one on file and a missing token is minted", async () => {
    await withEmailMock(async (sent) => {
      const { admin, tables } = fakeAdmin({
        athletes: [
          pendingAthlete({ user_id: USER, guardian_claim_token: null, added_by_coach_id: null }),
        ],
      });
      const out = await resendGuardianInvite(admin, USER, {
        athleteId: ATHLETE_ID,
        guardianEmail: "new@example.com",
      });
      expect(out.guardianEmail).toBe("new@example.com");
      expect(tables.athletes![0]).toMatchObject({
        guardian_email: "new@example.com",
        guardian_claim_token: MINTED,
      });
      expect(sent[0]).toMatchObject({ to: "new@example.com", token: MINTED, coachName: null });
    });
  });

  it("an athlete-addressed invite is re-sent in athlete voice", async () => {
    await withEmailMock(async (sent) => {
      const { admin } = fakeAdmin({
        athletes: [pendingAthlete({ user_id: USER, invite_recipient: "athlete" })],
        coach_profiles: [COACH],
      });
      await resendGuardianInvite(admin, USER, { athleteId: ATHLETE_ID });
      expect(sent[0]!.recipient).toBe("athlete");
    });
  });

  it("a coach with the athlete on roster may re-send; one without may not", async () => {
    await withEmailMock(async (sent) => {
      const linked = fakeAdmin({
        athletes: [pendingAthlete()],
        coach_profiles: [COACH],
        coach_athletes: [{ id: "l1", coach_id: COACH.id, athlete_id: ATHLETE_ID }],
      });
      await resendGuardianInvite(linked.admin, COACH.user_id, { athleteId: ATHLETE_ID });
      expect(sent).toHaveLength(1);

      const unlinked = fakeAdmin({ athletes: [pendingAthlete()], coach_profiles: [COACH] });
      await expect(
        resendGuardianInvite(unlinked.admin, COACH.user_id, { athleteId: ATHLETE_ID }),
      ).rejects.toMatchObject({
        code: "forbidden",
        status: 403,
        message: "You don't have access to this athlete.",
      });
      expect(sent).toHaveLength(1);
    });
  });

  it("403s a parent (or anyone else) — only the athlete or a rostered coach", async () => {
    await withEmailMock(async (sent) => {
      const { admin } = fakeAdmin({ athletes: [pendingAthlete()], parent_profiles: [PARENT] });
      await expect(
        resendGuardianInvite(admin, USER, { athleteId: ATHLETE_ID }),
      ).rejects.toMatchObject({ code: "forbidden", status: 403 });
      expect(sent).toHaveLength(0);
    });
  });

  it("404s an unknown athlete", async () => {
    const { admin } = fakeAdmin({ athletes: [] });
    await expect(
      resendGuardianInvite(admin, USER, { athleteId: ATHLETE_ID }),
    ).rejects.toMatchObject({ code: "not_found", status: 404, message: "Athlete not found." });
  });

  it("409s once the parent has joined", async () => {
    const { admin } = fakeAdmin({
      athletes: [pendingAthlete({ user_id: USER, guardian_claimed_at: "2026-09-02T00:00:00Z" })],
    });
    await expect(
      resendGuardianInvite(admin, USER, { athleteId: ATHLETE_ID }),
    ).rejects.toMatchObject({
      code: "conflict",
      status: 409,
      message: "This athlete's parent has already joined.",
    });
  });

  it("route body: no body at all means 're-send to the address on file' and parses as {}", () => {
    expect(resendGuardianInviteBodyInput.parse(undefined)).toEqual({});
    expect(resendGuardianInviteBodyInput.parse({})).toEqual({});
    expect(resendGuardianInviteBodyInput.parse({ guardianEmail: " New@Example.com " })).toEqual({
      guardianEmail: "new@example.com",
    });
    expect(() => resendGuardianInviteBodyInput.parse({ guardianEmail: "nope" })).toThrow();
  });

  it("route: POST with an empty body reaches the handler as {} and answers 200", async () => {
    process.env.API_V1_ENABLED = "true";
    const { admin } = fakeAdmin({});
    const ctx = { userId: USER, supabase: {} as ApiContext["supabase"], admin } as ApiContext;
    const received: unknown[] = [];
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/guardian/invites/{id}/resend",
        auth: "user",
        input: resendGuardianInviteBodyInput,
        output: z.object({ ok: z.literal(true), guardianEmail: z.string() }),
        handler: async ({ input, params }) => {
          received.push({ input, params });
          return { ok: true as const, guardianEmail: "guardian@example.com" };
        },
      },
      { admin: admin as ApiContext["admin"], authenticate: async () => ctx },
    );
    const res = await POST!({
      request: new Request(`https://gradus.training/api/v1/guardian/invites/${ATHLETE_ID}/resend`, {
        method: "POST",
        headers: { authorization: "Bearer t" },
      }),
      params: { id: ATHLETE_ID },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, guardianEmail: "guardian@example.com" });
    expect(received).toEqual([{ input: {}, params: { id: ATHLETE_ID } }]);
  });

  it("422s when no address is on file and none is supplied", async () => {
    await withEmailMock(async (sent) => {
      const { admin } = fakeAdmin({
        athletes: [pendingAthlete({ user_id: USER, guardian_email: null })],
      });
      await expect(
        resendGuardianInvite(admin, USER, { athleteId: ATHLETE_ID }),
      ).rejects.toMatchObject({
        code: "unprocessable",
        status: 422,
        message: "Add a parent or guardian email first.",
      });
      expect(sent).toHaveLength(0);
    });
  });
});

/* ================================================================= status */

describe("getMyGuardianStatus", () => {
  it("is null for a caller with no athlete row", async () => {
    const { admin } = fakeAdmin({ athletes: [] });
    expect(await getMyGuardianStatus(admin, USER, { apiContract: true })).toBeNull();
  });

  it("maps the row (minor, unclaimed, invited)", async () => {
    const { admin } = fakeAdmin({
      athletes: [pendingAthlete({ user_id: USER, birthdate: yearsAgo(10) })],
    });
    expect(await getMyGuardianStatus(admin, USER, { apiContract: true })).toEqual({
      athleteId: ATHLETE_ID,
      isMinor: true,
      guardianEmail: "guardian@example.com",
      claimed: false,
      invitedAt: "2026-09-01T00:00:00.000Z",
      accountState: "active",
    });
  });

  it("an adult with a claimed row", async () => {
    const { admin } = fakeAdmin({
      athletes: [
        pendingAthlete({
          user_id: USER,
          birthdate: yearsAgo(30),
          parent_id: PARENT.id,
          guardian_email: null,
          guardian_invited_at: null,
        }),
      ],
    });
    expect(await getMyGuardianStatus(admin, USER, { apiContract: true })).toEqual({
      athleteId: ATHLETE_ID,
      isMinor: false,
      guardianEmail: null,
      claimed: true,
      invitedAt: null,
      accountState: "active",
    });
  });

  it("D8: an unknown birthdate is a minor on the API, not a minor on the web (parity)", async () => {
    const { admin } = fakeAdmin({ athletes: [pendingAthlete({ user_id: USER, birthdate: null })] });
    expect((await getMyGuardianStatus(admin, USER, { apiContract: true }))!.isMinor).toBe(true);
    expect((await getMyGuardianStatus(admin, USER))!.isMinor).toBe(false);
  });

  it("isMinorConservative: calendar age, unknown or malformed counts as a minor", () => {
    expect(isMinorConservative(null)).toBe(true);
    expect(isMinorConservative("")).toBe(true);
    expect(isMinorConservative("not-a-date")).toBe(true);
    expect(isMinorConservative(yearsAgo(17))).toBe(true);
    expect(isMinorConservative(yearsAgo(18))).toBe(false);
    expect(isMinorConservative(yearsAgo(40))).toBe(false);
  });
});

/* ================================================================ context */

describe("getGuardianClaimContext", () => {
  it("names a returning parent", async () => {
    const { admin } = fakeAdmin({ parent_profiles: [PARENT] });
    expect(await getGuardianClaimContext(admin, USER)).toEqual({
      hasParentProfile: true,
      parentName: "Corin Abbott",
    });
  });

  it("is empty for a first-time claimer", async () => {
    const { admin } = fakeAdmin({ parent_profiles: [OTHER_PARENT] });
    expect(await getGuardianClaimContext(admin, USER)).toEqual({
      hasParentProfile: false,
      parentName: null,
    });
  });
});

/* ========================================================== merge options */

describe("getGuardianClaimMergeOptions", () => {
  it("ranks the caller's own athletes exact → close → other, then by name", async () => {
    const { admin } = fakeAdmin({
      athletes: [
        pendingAthlete({ first_name: "Leo", last_name: "Abbott" }),
        { id: "m1", parent_id: PARENT.id, first_name: "Maxwell", last_name: "Abbott" },
        { id: "m2", parent_id: PARENT.id, first_name: "Leopold", last_name: "Abbott" },
        { id: "m3", parent_id: PARENT.id, first_name: "LEO ", last_name: " abbott" },
        { id: "m4", parent_id: PARENT.id, first_name: "Ann", last_name: "Abbott" },
        { id: "other", parent_id: OTHER_PARENT.id, first_name: "Leo", last_name: "Abbott" },
      ],
      parent_profiles: [PARENT, OTHER_PARENT],
    });
    const out = await getGuardianClaimMergeOptions(admin, USER, { token: TOKEN });
    expect(out).toEqual({
      options: [
        { athleteId: "m3", name: "LEO   abbott", rank: "exact" },
        { athleteId: "m2", name: "Leopold Abbott", rank: "close" },
        { athleteId: "m4", name: "Ann Abbott", rank: "other" },
        { athleteId: "m1", name: "Maxwell Abbott", rank: "other" },
      ],
    });
  });

  it("excludes the pending athlete itself even if it already has the caller as parent", async () => {
    const { admin } = fakeAdmin({
      athletes: [pendingAthlete({ parent_id: PARENT.id })],
      parent_profiles: [PARENT],
    });
    expect(await getGuardianClaimMergeOptions(admin, USER, { token: TOKEN })).toEqual({
      options: [],
    });
  });

  it("is empty (never throws) for an unknown token or a caller without a parent profile", async () => {
    const unknown = fakeAdmin({ athletes: [pendingAthlete()], parent_profiles: [PARENT] });
    expect(
      await getGuardianClaimMergeOptions(unknown.admin, USER, { token: "c".repeat(48) }),
    ).toEqual({ options: [] });

    const noParent = fakeAdmin({ athletes: [pendingAthlete()] });
    expect(await getGuardianClaimMergeOptions(noParent.admin, USER, { token: TOKEN })).toEqual({
      options: [],
    });
  });
});

/* ================================================================== merge */

describe("mergeGuardianClaim", () => {
  function mergeSeed() {
    return {
      athletes: [
        pendingAthlete(),
        { id: MINE_ID, parent_id: PARENT.id, first_name: "Leo", last_name: "Abbott" },
        { id: OTHER_ATHLETE_ID, parent_id: OTHER_PARENT.id, first_name: "X", last_name: "Y" },
      ],
      parent_profiles: [PARENT, OTHER_PARENT],
      coach_athletes: [
        { id: "l1", coach_id: "coach-1", athlete_id: ATHLETE_ID },
        { id: "l2", coach_id: "coach-2", athlete_id: ATHLETE_ID },
        { id: "l3", coach_id: "coach-2", athlete_id: MINE_ID, coach_ack_at: null },
      ],
      coach_athlete_sports: [
        { id: "s1", coach_id: "coach-1", athlete_id: ATHLETE_ID, sport: "figure_skating" },
        { id: "s2", coach_id: "coach-2", athlete_id: ATHLETE_ID, sport: "hockey" },
        { id: "s3", coach_id: "coach-2", athlete_id: MINE_ID, sport: "hockey" },
      ],
      athlete_lesson_slots: [
        { id: "slot1", athlete_id: ATHLETE_ID },
        { id: "slot2", athlete_id: OTHER_ATHLETE_ID },
      ],
    };
  }

  it("carries links (both acks set), sports and lesson slots onto the target, then deletes the pending row", async () => {
    const { admin, tables, inserted } = fakeAdmin(mergeSeed());
    const out = await mergeGuardianClaim(admin, USER, { token: TOKEN, athleteId: MINE_ID });
    expect(out).toEqual({ ok: true, athleteFirstName: "Leo" });

    expect(inserted.coach_athletes).toHaveLength(1);
    expect(inserted.coach_athletes![0]).toMatchObject({ coach_id: "coach-1", athlete_id: MINE_ID });
    expect(typeof inserted.coach_athletes![0]!.coach_ack_at).toBe("string");
    expect(typeof inserted.coach_athletes![0]!.other_ack_at).toBe("string");
    // coach-2 already had the target: untouched, still un-acked.
    expect(tables.coach_athletes!.find((l) => l.id === "l3")!.coach_ack_at).toBeNull();

    expect(inserted.coach_athlete_sports).toEqual([
      {
        id: expect.stringMatching(/^row_/),
        coach_id: "coach-1",
        athlete_id: MINE_ID,
        sport: "figure_skating",
      },
    ]);

    expect(tables.athlete_lesson_slots!.find((s) => s.id === "slot1")!.athlete_id).toBe(MINE_ID);
    expect(tables.athlete_lesson_slots!.find((s) => s.id === "slot2")!.athlete_id).toBe(
      OTHER_ATHLETE_ID,
    );

    expect(tables.athletes!.some((a) => a.id === ATHLETE_ID)).toBe(false);
    expect(tables.athletes!.some((a) => a.id === MINE_ID)).toBe(true);
  });

  it("404s an unknown token", async () => {
    const { admin } = fakeAdmin(mergeSeed());
    await expect(
      mergeGuardianClaim(admin, USER, { token: "c".repeat(48), athleteId: MINE_ID }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("409s an already-claimed invite", async () => {
    const seed = mergeSeed();
    seed.athletes[0] = pendingAthlete({ guardian_claimed_at: "2026-09-02T00:00:00Z" });
    const { admin, tables } = fakeAdmin(seed);
    await expect(
      mergeGuardianClaim(admin, USER, { token: TOKEN, athleteId: MINE_ID }),
    ).rejects.toMatchObject({
      code: "conflict",
      status: 409,
      message: "This invite has already been claimed.",
    });
    expect(tables.athletes).toHaveLength(3);
  });

  it("422s a caller without a parent profile", async () => {
    const { admin } = fakeAdmin(mergeSeed());
    await expect(
      mergeGuardianClaim(admin, "nobody", { token: TOKEN, athleteId: MINE_ID }),
    ).rejects.toMatchObject({
      code: "unprocessable",
      status: 422,
      message: "Create your parent account first.",
    });
  });

  it("403s a target that is not the caller's own athlete (another parent's, or missing)", async () => {
    const { admin, tables } = fakeAdmin(mergeSeed());
    await expect(
      mergeGuardianClaim(admin, USER, { token: TOKEN, athleteId: OTHER_ATHLETE_ID }),
    ).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
      message: "That athlete isn't on your account.",
    });
    await expect(
      mergeGuardianClaim(admin, USER, {
        token: TOKEN,
        athleteId: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(tables.athletes).toHaveLength(3);
    expect(tables.athlete_lesson_slots![0]!.athlete_id).toBe(ATHLETE_ID);
  });
});

/* ============================================================= self-claim */

describe("claimAthleteSelf", () => {
  const ADULT_DOB = "1990-06-15";

  it("attaches the pending row to the signed-in adult", async () => {
    const { admin, tables } = fakeAdmin({
      athletes: [pendingAthlete({ invite_recipient: "athlete", birthdate: null })],
    });
    const out = await claimAthleteSelf(
      admin,
      USER,
      { token: TOKEN, birthdate: ADULT_DOB },
      { apiContract: true },
    );
    expect(out).toEqual({ ok: true, athleteFirstName: "Leo" });
    expect(tables.athletes![0]).toMatchObject({
      user_id: USER,
      self_managed: true,
      birthdate: ADULT_DOB,
      guardian_email: null,
      guardian_claim_token: null,
      parent_id: null,
    });
    expect(typeof tables.athletes![0]!.guardian_claimed_at).toBe("string");
  });

  it("422s a claimer under 18 (web message, verbatim) and an unparseable date", async () => {
    const { admin } = fakeAdmin({ athletes: [pendingAthlete({ invite_recipient: "athlete" })] });
    await expect(
      claimAthleteSelf(admin, USER, { token: TOKEN, birthdate: yearsAgo(15) }),
    ).rejects.toMatchObject({
      code: "unprocessable",
      status: 422,
      message:
        "You're under 18 — ask a parent or guardian to open this link and set the account up.",
    });
    await expect(
      claimAthleteSelf(admin, USER, { token: TOKEN, birthdate: "1990-13-01" }),
    ).rejects.toMatchObject({
      code: "unprocessable",
      status: 422,
      message: "Enter your date of birth",
    });
  });

  it("API: 'under 18' is calendar age — the day before the 18th birthday is refused, the birthday itself passes", async () => {
    const turnsEighteenTomorrow = shiftDays(yearsAgo(18), 1);
    const minor = fakeAdmin({
      athletes: [pendingAthlete({ invite_recipient: "athlete" })],
    });
    await expect(
      claimAthleteSelf(
        minor.admin,
        USER,
        { token: TOKEN, birthdate: turnsEighteenTomorrow },
        { apiContract: true },
      ),
    ).rejects.toMatchObject({
      code: "unprocessable",
      status: 422,
      message:
        "You're under 18 — ask a parent or guardian to open this link and set the account up.",
    });
    expect(minor.tables.athletes![0]!.user_id).toBeNull();

    const adult = fakeAdmin({ athletes: [pendingAthlete({ invite_recipient: "athlete" })] });
    const out = await claimAthleteSelf(
      adult.admin,
      USER,
      { token: TOKEN, birthdate: yearsAgo(18) },
      { apiContract: true },
    );
    expect(out.ok).toBe(true);
    expect(adult.tables.athletes![0]).toMatchObject({ user_id: USER, birthdate: yearsAgo(18) });
  });

  it("API: the age trigger's refusal (23514) is the same 422, not a 500; the web keeps dbError", async () => {
    const updateError = {
      table: "athletes",
      error: {
        code: "23514",
        message: "Athletes under 18 need a parent or guardian email on file",
      },
    };
    const api = fakeAdmin(
      { athletes: [pendingAthlete({ invite_recipient: "athlete" })] },
      { updateError },
    );
    await expect(
      claimAthleteSelf(
        api.admin,
        USER,
        { token: TOKEN, birthdate: ADULT_DOB },
        { apiContract: true },
      ),
    ).rejects.toMatchObject({
      code: "unprocessable",
      status: 422,
      message:
        "You're under 18 — ask a parent or guardian to open this link and set the account up.",
    });

    const web = fakeAdmin(
      { athletes: [pendingAthlete({ invite_recipient: "athlete" })] },
      { updateError },
    );
    const webErr = await claimAthleteSelf(web.admin, USER, {
      token: TOKEN,
      birthdate: ADULT_DOB,
    }).catch((e: unknown) => e);
    expect(webErr).toBeInstanceOf(Error);
    expect(webErr).not.toBeInstanceOf(ApiError);
    expect((webErr as Error).message).toBe("Something went wrong. Please try again.");
  });

  it("404s an unknown token", async () => {
    const { admin } = fakeAdmin({ athletes: [pendingAthlete({ invite_recipient: "athlete" })] });
    await expect(
      claimAthleteSelf(admin, USER, { token: "c".repeat(48), birthdate: ADULT_DOB }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("D4: the API refuses a guardian-addressed link; the web keeps parity", async () => {
    for (const invite_recipient of ["guardian", null]) {
      const api = fakeAdmin({ athletes: [pendingAthlete({ invite_recipient })] });
      await expect(
        claimAthleteSelf(
          api.admin,
          USER,
          { token: TOKEN, birthdate: ADULT_DOB },
          { apiContract: true },
        ),
      ).rejects.toMatchObject({
        code: "forbidden",
        status: 403,
        message: "This link was sent to a parent or guardian.",
      });
      expect(api.tables.athletes![0]!.user_id).toBeNull();

      const web = fakeAdmin({ athletes: [pendingAthlete({ invite_recipient })] });
      const out = await claimAthleteSelf(web.admin, USER, { token: TOKEN, birthdate: ADULT_DOB });
      expect(out.ok).toBe(true);
      expect(web.tables.athletes![0]!.user_id).toBe(USER);
    }
  });

  it("409s a row that already has a login, a parent, or a claim stamp", async () => {
    for (const over of [
      { user_id: "someone" },
      { parent_id: PARENT.id },
      { guardian_claimed_at: "2026-09-02T00:00:00Z" },
    ]) {
      const { admin } = fakeAdmin({
        athletes: [pendingAthlete({ invite_recipient: "athlete", ...over })],
      });
      await expect(
        claimAthleteSelf(
          admin,
          USER,
          { token: TOKEN, birthdate: ADULT_DOB },
          { apiContract: true },
        ),
      ).rejects.toMatchObject({
        code: "conflict",
        status: 409,
        message: "This invite has already been claimed.",
      });
    }
  });

  it("403 wrong_role for a coach account", async () => {
    const { admin } = fakeAdmin({
      athletes: [pendingAthlete({ invite_recipient: "athlete" })],
      coach_profiles: [COACH],
    });
    await expect(
      claimAthleteSelf(
        admin,
        COACH.user_id,
        { token: TOKEN, birthdate: ADULT_DOB },
        { apiContract: true },
      ),
    ).rejects.toMatchObject({
      code: "wrong_role",
      status: 403,
      message: "You're signed in as a coach. Sign out and use your athlete account.",
    });
  });

  it("409s a caller who already has an athlete profile", async () => {
    const { admin, tables } = fakeAdmin({
      athletes: [
        pendingAthlete({ invite_recipient: "athlete" }),
        { id: MINE_ID, user_id: USER, first_name: "Me", last_name: "Too" },
      ],
    });
    await expect(
      claimAthleteSelf(admin, USER, { token: TOKEN, birthdate: ADULT_DOB }, { apiContract: true }),
    ).rejects.toMatchObject({
      code: "conflict",
      status: 409,
      message: "You already have an athlete profile on this account.",
    });
    expect(tables.athletes![0]!.user_id).toBeNull();
  });
});
