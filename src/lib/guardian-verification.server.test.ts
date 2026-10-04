import { describe, expect, it } from "bun:test";
import {
  activateAthletesForVerifiedParent,
  assertParentVerified,
  athleteRoomGate,
  completeVerificationFromRedirect,
  grantGuardianConsent,
  handleKwsWebhook,
  isUnderThirteen,
  provisionalCutoff,
  recordParentVerification,
  revokeGuardianConsent,
  setCoachMessagingPause,
  startParentVerification,
  sweepProvisionalAthletes,
  toParentVerificationDTO,
} from "./guardian-verification.server";
import { encodeExternalPayload, hmacSha256Hex } from "./kws.server";
import { isMinorOrUnconfirmed } from "./athlete-age";

/* -------------------------------------------------------------------------- */
/* A small in-memory Supabase-shaped fake: the chains this module uses         */
/* (select/eq/is/lt/order/limit/maybeSingle, insert, update…select) plus       */
/* `auth.admin.getUserById` and a unique index on webhook_receipts.            */
/* -------------------------------------------------------------------------- */

type Row = Record<string, any>;
type Admin = Parameters<typeof startParentVerification>[0];

function fakeAdmin(
  seed: Record<string, Row[]>,
  opts: { users?: Record<string, { email?: string | null }> } = {},
) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  let counter = 0;
  const uniqueKeys: Record<string, string[]> = { webhook_receipts: ["source", "external_id"] };

  function from(table: string) {
    const st = {
      filters: [] as Array<(r: Row) => boolean>,
      mode: "select" as "select" | "insert" | "update",
      payload: null as any,
      order: null as null | { col: string; asc: boolean },
      limit: undefined as number | undefined,
    };
    const exec = (): { data: any; error: any } => {
      tables[table] ??= [];
      if (st.mode === "insert") {
        const rows: Row[] = (Array.isArray(st.payload) ? st.payload : [st.payload]).map(
          (r: Row) => ({
            id: `row_${++counter}`,
            ...r,
          }),
        );
        const uk = uniqueKeys[table];
        if (uk) {
          for (const r of rows) {
            if (tables[table].some((ex) => uk.every((k) => ex[k] === r[k]))) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
          }
        }
        tables[table].push(...rows);
        return { data: rows, error: null };
      }
      let rows = tables[table].filter((r) => st.filters.every((f) => f(r)));
      if (st.mode === "update") {
        for (const r of rows) Object.assign(r, st.payload);
        return { data: rows, error: null };
      }
      if (st.order) {
        const { col, asc } = st.order;
        rows = [...rows].sort(
          (a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1),
        );
      }
      if (st.limit != null) rows = rows.slice(0, st.limit);
      return { data: rows, error: null };
    };
    const api: any = {
      select: () => api,
      insert: (p: any) => {
        st.mode = "insert";
        st.payload = p;
        return api;
      },
      update: (p: any) => {
        st.mode = "update";
        st.payload = p;
        return api;
      },
      eq: (c: string, v: unknown) => {
        st.filters.push((r) => r[c] === v);
        return api;
      },
      is: (c: string, v: unknown) => {
        st.filters.push((r) => (r[c] ?? null) === v);
        return api;
      },
      lt: (c: string, v: any) => {
        st.filters.push((r) => r[c] < v);
        return api;
      },
      in: (c: string, vs: unknown[]) => {
        st.filters.push((r) => vs.includes(r[c]));
        return api;
      },
      order: (c: string, o?: { ascending?: boolean }) => {
        st.order = { col: c, asc: o?.ascending !== false };
        return api;
      },
      limit: (n: number) => {
        st.limit = n;
        return api;
      },
      maybeSingle: async () => {
        const res = exec();
        if (res.error) return res;
        return { data: res.data[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(resolve, reject),
    };
    return api;
  }

  return {
    from,
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const u = opts.users?.[id];
          return { data: { user: u ? { id, email: u.email ?? null } : null }, error: null };
        },
      },
    },
    tables,
  } as unknown as Admin & { tables: Record<string, Row[]> };
}

const PARENT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-09-24T12:00:00Z");

const OFF = {} as NodeJS.ProcessEnv;
const REQUIRED = { PARENT_VERIFICATION_REQUIRED: "true" } as NodeJS.ProcessEnv;
const KWS = {
  PARENT_VERIFICATION_REQUIRED: "true",
  KWS_CLIENT_ID: "client",
  KWS_API_KEY: "key",
  KWS_API_HOST: "https://api.test",
  KWS_WEBHOOK_SECRET: "whsec",
  KWS_VERIFICATION_SECRET: "vsec",
} as NodeJS.ProcessEnv;

const unverifiedParent = () => ({
  id: PARENT,
  user_id: USER,
  adult_verified_at: null,
  adult_verification_method: null,
  adult_verification_ref: null,
  adult_verification_requested_at: null,
});

describe("toParentVerificationDTO / assertParentVerified", () => {
  it("reports legacy parents as verified and the switch as off by default", () => {
    const dto = toParentVerificationDTO(
      {
        adult_verified_at: "2026-09-24T00:00:00Z",
        adult_verification_method: "legacy",
        adult_verification_requested_at: null,
      },
      OFF,
    );
    expect(dto).toEqual({
      required: false,
      available: false,
      verified: true,
      method: "legacy",
      verifiedAt: "2026-09-24T00:00:00Z",
      requestedAt: null,
    });
  });

  it("gates only when required and unverified", async () => {
    const admin = fakeAdmin({ parent_profiles: [unverifiedParent()] });
    await expect(assertParentVerified(admin, PARENT, OFF)).resolves.toBeUndefined();
    await expect(assertParentVerified(admin, PARENT, REQUIRED)).rejects.toMatchObject({
      code: "parent_unverified",
      status: 403,
    });
    admin.tables.parent_profiles[0].adult_verified_at = NOW.toISOString();
    admin.tables.parent_profiles[0].adult_verification_method = "kws_card";
    await expect(assertParentVerified(admin, PARENT, REQUIRED)).resolves.toBeUndefined();
  });
});

describe("startParentVerification", () => {
  function fetchOk() {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? "") });
      if (url.endsWith("/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
    return { calls, fetchImpl };
  }

  it("refuses a caller with no parent profile", async () => {
    const admin = fakeAdmin({ parent_profiles: [] });
    await expect(startParentVerification(admin, USER, { env: KWS })).rejects.toMatchObject({
      code: "wrong_role",
    });
  });

  it("short-circuits a verified parent and reports a missing KWS setup", async () => {
    const verified = {
      ...unverifiedParent(),
      adult_verified_at: "2026-01-01T00:00:00Z",
      adult_verification_method: "admin",
    };
    expect(
      await startParentVerification(fakeAdmin({ parent_profiles: [verified] }), USER, { env: KWS }),
    ).toEqual({ status: "already_verified" });
    expect(
      await startParentVerification(fakeAdmin({ parent_profiles: [unverifiedParent()] }), USER, {
        env: REQUIRED,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("emails the parent's own account address and stamps requested_at", async () => {
    const admin = fakeAdmin(
      { parent_profiles: [unverifiedParent()] },
      { users: { [USER]: { email: "Parent@Example.com" } } },
    );
    const { calls, fetchImpl } = fetchOk();
    const result = await startParentVerification(admin, USER, {
      env: { ...KWS, KWS_TOKEN_URL: "https://auth.test/token" },
      now: NOW,
      client: { fetchImpl },
    });
    expect(result).toEqual({ status: "email_sent" });
    const send = JSON.parse(calls[1].body);
    expect(send.email).toBe("parent@example.com");
    expect(send.userContext).toBe("parent");
    expect(send.location).toBe("US");
    expect(JSON.parse(send.externalPayload)).toEqual({ p: PARENT, u: USER });
    expect(admin.tables.parent_profiles[0].adult_verification_requested_at).toBe(NOW.toISOString());
  });

  it("does not resend inside the cooldown, and reports KWS's rate limit", async () => {
    const recent = {
      ...unverifiedParent(),
      adult_verification_requested_at: new Date(NOW.getTime() - 20_000).toISOString(),
    };
    const admin = fakeAdmin(
      { parent_profiles: [recent] },
      { users: { [USER]: { email: "p@e.com" } } },
    );
    const { calls, fetchImpl } = fetchOk();
    expect(
      await startParentVerification(admin, USER, { env: KWS, now: NOW, client: { fetchImpl } }),
    ).toEqual({ status: "email_sent" });
    expect(calls).toHaveLength(0);

    const admin2 = fakeAdmin(
      { parent_profiles: [unverifiedParent()] },
      { users: { [USER]: { email: "p@e.com" } } },
    );
    const limited = async (url: string) =>
      url.endsWith("/token")
        ? new Response(JSON.stringify({ access_token: "tok" }), { status: 200 })
        : new Response("{}", { status: 429 });
    expect(
      await startParentVerification(admin2, USER, {
        env: { ...KWS, KWS_TOKEN_URL: "https://auth.test/token" },
        now: NOW,
        client: { fetchImpl: limited },
      }),
    ).toEqual({ status: "rate_limited" });
    expect(admin2.tables.parent_profiles[0].adult_verification_requested_at).toBeNull();
  });

  it("answers 503 verification_unavailable when KWS itself fails", async () => {
    const admin = fakeAdmin(
      { parent_profiles: [unverifiedParent()] },
      { users: { [USER]: { email: "p@e.com" } } },
    );
    const broken = async () => new Response("{}", { status: 401 });
    await expect(
      startParentVerification(admin, USER, {
        env: { ...KWS, KWS_TOKEN_URL: "https://auth.test/token" },
        client: { fetchImpl: broken },
      }),
    ).rejects.toMatchObject({ code: "verification_unavailable", status: 503 });
  });

  it("refuses an account with no email", async () => {
    const admin = fakeAdmin(
      { parent_profiles: [unverifiedParent()] },
      { users: { [USER]: { email: null } } },
    );
    await expect(startParentVerification(admin, USER, { env: KWS })).rejects.toMatchObject({
      code: "unprocessable",
      status: 422,
    });
  });
});

async function signedWebhook(body: string, secret: string, now: Date) {
  const t = String(Math.floor(now.getTime() / 1000));
  const sig = await hmacSha256Hex(secret, `${t}.${body}`);
  return new Request("https://gradus.training/api/public/webhooks/kws", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-kws-signature": `t=${t},v1=${sig}` },
    body,
  });
}

const verifiedEvent = (transactionId: string, verified = true) =>
  JSON.stringify({
    name: "parent-verified",
    time: NOW.toISOString(),
    orgId: "org",
    productId: "prod",
    payload: {
      parentEmail: "parent@example.com",
      externalPayload: encodeExternalPayload({ parentId: PARENT, userId: USER }),
      status: { verified, transactionId },
    },
  });

describe("handleKwsWebhook", () => {
  it("marks the parent verified once and treats a redelivery as a duplicate", async () => {
    const admin = fakeAdmin({ parent_profiles: [unverifiedParent()], webhook_receipts: [] });
    const body = verifiedEvent("tx-1");
    const first = await handleKwsWebhook(admin, await signedWebhook(body, "whsec", NOW), {
      env: KWS,
      now: NOW,
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, applied: true, duplicate: false });
    const parent = admin.tables.parent_profiles[0];
    expect(parent.adult_verification_method).toBe("kws_card");
    expect(parent.adult_verification_ref).toBe("tx-1");
    expect(parent.adult_verified_at).toBe(NOW.toISOString());

    const again = await handleKwsWebhook(admin, await signedWebhook(body, "whsec", NOW), {
      env: KWS,
      now: NOW,
    });
    expect(await again.json()).toEqual({ ok: true, applied: false, duplicate: true });
    expect(admin.tables.webhook_receipts).toHaveLength(1);
    // The receipt keeps ids and status, never the parent's email.
    expect(JSON.stringify(admin.tables.webhook_receipts[0].payload)).not.toContain(
      "parent@example.com",
    );
  });

  it("rejects a bad signature, and answers 503 with no secret configured", async () => {
    const admin = fakeAdmin({ parent_profiles: [unverifiedParent()], webhook_receipts: [] });
    const body = verifiedEvent("tx-2");
    const forged = await handleKwsWebhook(admin, await signedWebhook(body, "wrong", NOW), {
      env: KWS,
      now: NOW,
    });
    expect(forged.status).toBe(401);
    expect(admin.tables.parent_profiles[0].adult_verification_method).toBeNull();
    const unset = await handleKwsWebhook(admin, await signedWebhook(body, "whsec", NOW), {
      env: OFF,
      now: NOW,
    });
    expect(unset.status).toBe(503);
  });

  it("ignores other events and a failed verification without touching the parent", async () => {
    const admin = fakeAdmin({ parent_profiles: [unverifiedParent()], webhook_receipts: [] });
    const other = JSON.stringify({
      name: "something-else",
      payload: { status: { verified: true, transactionId: "x" } },
    });
    const res = await handleKwsWebhook(admin, await signedWebhook(other, "whsec", NOW), {
      env: KWS,
      now: NOW,
    });
    expect(await res.json()).toEqual({ ok: true, ignored: true });

    const failed = await handleKwsWebhook(
      admin,
      await signedWebhook(verifiedEvent("tx-3", false), "whsec", NOW),
      { env: KWS, now: NOW },
    );
    expect(await failed.json()).toEqual({ ok: true, applied: false, duplicate: false });
    expect(admin.tables.parent_profiles[0].adult_verification_method).toBeNull();
    expect(admin.tables.webhook_receipts).toHaveLength(1);
  });

  it("does not apply an event whose parent has moved to another auth user", async () => {
    const admin = fakeAdmin({
      parent_profiles: [{ ...unverifiedParent(), user_id: OTHER_USER }],
      webhook_receipts: [],
    });
    const res = await handleKwsWebhook(
      admin,
      await signedWebhook(verifiedEvent("tx-4"), "whsec", NOW),
      { env: KWS, now: NOW },
    );
    expect(await res.json()).toEqual({ ok: true, applied: false, duplicate: false });
    expect(admin.tables.parent_profiles[0].adult_verification_method).toBeNull();
  });
});

describe("completeVerificationFromRedirect", () => {
  it("records a genuine Verification Response and rejects a forged one", async () => {
    const admin = fakeAdmin({ parent_profiles: [unverifiedParent()], webhook_receipts: [] });
    const status = JSON.stringify({
      verified: true,
      transactionId: "tx-9",
      errorCode: null,
      timestamp: 1770000000,
    });
    const externalPayload = encodeExternalPayload({ parentId: PARENT, userId: USER });
    const signature = await hmacSha256Hex("vsec", `${status}:${externalPayload}`);

    const ok = await completeVerificationFromRedirect(
      admin,
      { status, externalPayload, signatures: [signature] },
      { env: KWS, now: NOW },
    );
    expect(ok).toEqual({ ok: true, verified: true, duplicate: false, reason: null });
    expect(admin.tables.parent_profiles[0].adult_verification_ref).toBe("tx-9");

    // The webhook for the same transaction still lands under its own source.
    const wh = await recordParentVerification(admin, {
      source: "kws",
      event: "parent-verified",
      transactionId: "tx-9",
      verified: true,
      parentId: PARENT,
      userId: USER,
      payload: {},
      now: NOW,
    });
    expect(wh).toEqual({ applied: true, duplicate: false });
    expect(admin.tables.webhook_receipts).toHaveLength(2);

    const forged = await completeVerificationFromRedirect(
      admin,
      { status: status.replace("tx-9", "tx-8"), externalPayload, signatures: [signature] },
      { env: KWS },
    );
    expect(forged).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(
      await completeVerificationFromRedirect(
        admin,
        { status, externalPayload, signatures: [signature] },
        { env: OFF },
      ),
    ).toMatchObject({ ok: false, reason: "not_configured" });
  });
});

describe("consent ledger", () => {
  it("grants missing scopes only, and revokes active ones", async () => {
    const admin = fakeAdmin({ guardian_consents: [] });
    const a = await grantGuardianConsent(admin, {
      athleteId: "ath",
      parentId: PARENT,
      method: "guardian_claim",
      now: NOW,
    });
    expect(a.granted).toEqual(["account", "messaging"]);
    const b = await grantGuardianConsent(admin, {
      athleteId: "ath",
      parentId: PARENT,
      method: "guardian_claim",
      now: NOW,
    });
    expect(b.granted).toEqual([]);
    expect(admin.tables.guardian_consents).toHaveLength(2);

    const revoked = await revokeGuardianConsent(admin, {
      athleteId: "ath",
      reason: "unlinked",
      now: NOW,
    });
    expect(revoked).toBe(2);
    expect(admin.tables.guardian_consents.every((r) => r.revoked_at === NOW.toISOString())).toBe(
      true,
    );

    const c = await grantGuardianConsent(admin, {
      athleteId: "ath",
      parentId: PARENT,
      method: "guardian_claim",
      scopes: ["messaging"],
      now: NOW,
    });
    expect(c.granted).toEqual(["messaging"]);
  });
});

describe("sweepProvisionalAthletes", () => {
  it("cuts off three calendar months back, clamping to a shorter month's last day", () => {
    expect(provisionalCutoff(new Date("2026-09-24T12:00:00Z")).toISOString()).toBe(
      "2026-06-24T12:00:00.000Z",
    );
    expect(provisionalCutoff(new Date("2026-01-31T00:00:00Z")).toISOString()).toBe(
      "2025-10-31T00:00:00.000Z",
    );
    // May 31 minus three months is not "February 31" (March 3); it is February 28.
    expect(provisionalCutoff(new Date("2026-05-31T09:00:00Z")).toISOString()).toBe(
      "2026-02-28T09:00:00.000Z",
    );
  });

  it("deletes only old, unclaimed provisional accounts, row then auth user", async () => {
    const admin = fakeAdmin({
      athletes: [
        {
          id: "old",
          user_id: "u-old",
          parent_id: null,
          account_state: "provisional",
          created_at: "2026-05-01T00:00:00Z",
        },
        {
          id: "fresh",
          user_id: "u-fresh",
          parent_id: null,
          account_state: "provisional",
          created_at: "2026-09-20T00:00:00Z",
        },
        {
          id: "claimed",
          user_id: "u-claimed",
          parent_id: PARENT,
          account_state: "active",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "old-claimed-late",
          user_id: "u-x",
          parent_id: PARENT,
          account_state: "provisional",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const purged: string[] = [];
    const deletedUsers: string[] = [];
    const result = await sweepProvisionalAthletes(admin, {
      now: NOW,
      deps: {
        purgeAthlete: async (id) => {
          purged.push(id);
        },
        deleteAuthUser: async (id) => {
          deletedUsers.push(id);
        },
      },
    });
    expect(result).toEqual({ scanned: 1, deleted: 1, failed: 0 });
    expect(purged).toEqual(["old"]);
    expect(deletedUsers).toEqual(["u-old"]);
  });

  it("also sweeps an unclaimed provisional account Apple's RESCIND_CONSENT paused, never a paused adult", async () => {
    const admin = fakeAdmin({
      athletes: [
        {
          id: "rescinded-teen",
          user_id: "u-teen",
          parent_id: null,
          account_state: "paused",
          guardian_email: "parent@example.com",
          guardian_claimed_at: null,
          birthdate: "2011-03-09",
          created_at: "2026-05-01T00:00:00Z",
        },
        {
          id: "paused-adult",
          user_id: "u-adult",
          parent_id: null,
          account_state: "paused",
          guardian_email: null,
          guardian_claimed_at: null,
          birthdate: "1990-01-01",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const purged: string[] = [];
    const result = await sweepProvisionalAthletes(admin, {
      now: NOW,
      deps: {
        purgeAthlete: async (id) => {
          purged.push(id);
        },
        deleteAuthUser: async () => {},
      },
    });
    expect(result).toEqual({ scanned: 1, deleted: 1, failed: 0 });
    expect(purged).toEqual(["rescinded-teen"]);
  });

  it("counts a failure and keeps going", async () => {
    const admin = fakeAdmin({
      athletes: [
        {
          id: "a",
          user_id: "u-a",
          parent_id: null,
          account_state: "provisional",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "b",
          user_id: null,
          parent_id: null,
          account_state: "provisional",
          created_at: "2026-02-01T00:00:00Z",
        },
      ],
    });
    const result = await sweepProvisionalAthletes(admin, {
      now: NOW,
      deps: {
        purgeAthlete: async (id) => {
          if (id === "a") throw new Error("boom");
        },
        deleteAuthUser: async () => {},
      },
    });
    expect(result).toEqual({ scanned: 2, deleted: 1, failed: 1 });
  });
});

/* ------------------------------------------------------------------ rules */

const yearsAgo = (n: number) => {
  const d = new Date(NOW.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
};

describe("age helpers", () => {
  it("treats a missing or unparseable birthdate as a minor, and 13 as not under 13", () => {
    expect(isMinorOrUnconfirmed(null)).toBe(true);
    expect(isMinorOrUnconfirmed("nope")).toBe(true);
    expect(isMinorOrUnconfirmed(yearsAgo(17))).toBe(true);
    expect(isMinorOrUnconfirmed(yearsAgo(30))).toBe(false);
    expect(isUnderThirteen(yearsAgo(12))).toBe(true);
    expect(isUnderThirteen(yearsAgo(13))).toBe(false);
  });
});

describe("athleteRoomGate", () => {
  const COACH = "c1";
  const minorRow = (extra: Row = {}) => ({
    id: "ath",
    birthdate: yearsAgo(14),
    parent_id: null,
    account_state: "active",
    ...extra,
  });
  const linkRow = (extra: Row = {}) => ({
    coach_id: COACH,
    athlete_id: "ath",
    messaging_paused_at: null,
    ...extra,
  });

  it("with the switch off, a minor with no parent is only blocked when provisional or paused", async () => {
    expect(
      await athleteRoomGate(
        fakeAdmin({ athletes: [minorRow()], coach_athletes: [linkRow()] }),
        "ath",
        COACH,
        OFF,
      ),
    ).toEqual({ restriction: null, minor: true });
    expect(
      await athleteRoomGate(
        fakeAdmin({
          athletes: [minorRow({ account_state: "provisional" })],
          coach_athletes: [linkRow()],
        }),
        "ath",
        COACH,
        OFF,
      ),
    ).toEqual({ restriction: "provisional", minor: true });
    expect(
      await athleteRoomGate(
        fakeAdmin({
          athletes: [minorRow({ account_state: "paused" })],
          coach_athletes: [linkRow()],
        }),
        "ath",
        COACH,
        OFF,
      ),
    ).toEqual({ restriction: "paused", minor: true });
  });

  it("with the switch on, a minor needs a verified parent as a participant", async () => {
    const noParent = fakeAdmin({ athletes: [minorRow()], coach_athletes: [linkRow()] });
    expect(await athleteRoomGate(noParent, "ath", COACH, REQUIRED)).toEqual({
      restriction: "guardian_required",
      minor: true,
    });

    const unverified = fakeAdmin({
      athletes: [minorRow({ parent_id: PARENT })],
      coach_athletes: [linkRow()],
      parent_profiles: [unverifiedParent()],
    });
    expect(await athleteRoomGate(unverified, "ath", COACH, REQUIRED)).toEqual({
      restriction: "guardian_required",
      minor: true,
    });

    const legacy = fakeAdmin({
      athletes: [minorRow({ parent_id: PARENT })],
      coach_athletes: [linkRow()],
      parent_profiles: [
        {
          ...unverifiedParent(),
          adult_verified_at: "2026-01-01T00:00:00Z",
          adult_verification_method: "legacy",
        },
      ],
    });
    expect(await athleteRoomGate(legacy, "ath", COACH, REQUIRED)).toEqual({
      restriction: null,
      minor: true,
    });
  });

  it("a parent's pause stops the room for anyone, adults included; adults are otherwise free", async () => {
    const adultPaused = fakeAdmin({
      athletes: [minorRow({ birthdate: yearsAgo(25) })],
      coach_athletes: [linkRow({ messaging_paused_at: NOW.toISOString() })],
    });
    expect(await athleteRoomGate(adultPaused, "ath", COACH, REQUIRED)).toEqual({
      restriction: "paused_by_parent",
      minor: false,
    });
    const adult = fakeAdmin({
      athletes: [minorRow({ birthdate: yearsAgo(25) })],
      coach_athletes: [linkRow()],
    });
    expect(await athleteRoomGate(adult, "ath", COACH, REQUIRED)).toEqual({
      restriction: null,
      minor: false,
    });
    expect(await athleteRoomGate(fakeAdmin({ athletes: [] }), "missing", COACH, OFF)).toEqual({
      restriction: "guardian_required",
      minor: true,
    });
  });
});

describe("activateAthletesForVerifiedParent / setCoachMessagingPause", () => {
  it("turns the parent's provisional athletes active and records consent for all of them", async () => {
    const admin = fakeAdmin({
      athletes: [
        { id: "a1", parent_id: PARENT, account_state: "provisional" },
        { id: "a2", parent_id: PARENT, account_state: "active" },
        { id: "other", parent_id: "someone-else", account_state: "provisional" },
      ],
      guardian_consents: [],
    });
    const result = await activateAthletesForVerifiedParent(admin, PARENT, {
      now: NOW,
      evidence: { verification: "kws_card" },
    });
    expect(result).toEqual({ activated: 1, athletes: 2 });
    expect(admin.tables.athletes.find((a) => a.id === "a1")?.account_state).toBe("active");
    expect(admin.tables.athletes.find((a) => a.id === "other")?.account_state).toBe("provisional");
    expect(admin.tables.guardian_consents).toHaveLength(4);
    expect(admin.tables.guardian_consents.every((c) => c.method === "parent_created")).toBe(true);
    // Idempotent on a second run.
    expect(await activateAthletesForVerifiedParent(admin, PARENT, { now: NOW })).toEqual({
      activated: 0,
      athletes: 2,
    });
    expect(admin.tables.guardian_consents).toHaveLength(4);
  });

  it("a KWS verification activates the parent's athletes too", async () => {
    const admin = fakeAdmin({
      parent_profiles: [unverifiedParent()],
      athletes: [{ id: "a1", parent_id: PARENT, account_state: "provisional" }],
      guardian_consents: [],
      webhook_receipts: [],
    });
    await recordParentVerification(admin, {
      source: "kws",
      event: "parent-verified",
      transactionId: "tx",
      verified: true,
      parentId: PARENT,
      userId: USER,
      payload: {},
      now: NOW,
    });
    expect(admin.tables.athletes[0].account_state).toBe("active");
    expect(admin.tables.guardian_consents.map((c) => c.scope).sort()).toEqual([
      "account",
      "messaging",
    ]);
  });

  it("pauses and resumes a coach link, and 404s an unknown link", async () => {
    const admin = fakeAdmin({
      coach_athletes: [{ id: "l1", coach_id: "c1", athlete_id: "ath", messaging_paused_at: null }],
    });
    expect(
      await setCoachMessagingPause(admin, {
        athleteId: "ath",
        coachId: "c1",
        paused: true,
        now: NOW,
      }),
    ).toEqual({ ok: true, paused: true });
    expect(admin.tables.coach_athletes[0].messaging_paused_at).toBe(NOW.toISOString());
    expect(
      await setCoachMessagingPause(admin, { athleteId: "ath", coachId: "c1", paused: false }),
    ).toEqual({ ok: true, paused: false });
    expect(admin.tables.coach_athletes[0].messaging_paused_at).toBeNull();
    await expect(
      setCoachMessagingPause(admin, { athleteId: "ath", coachId: "nope", paused: true }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
