import { describe, expect, it } from "bun:test";
import {
  RESCIND_CONSENT_REASON,
  handleAppStoreNotification,
  registerAppTransaction,
  type AppStoreDeps,
} from "./app-store-notifications.server";
import { ApiError } from "./api/errors";
import { signTestJws, TEST_ROOTS } from "./apple-signed-data.test-helpers";
import {
  TEST_DEVELOPER_LEAF_B64,
  TEST_INTERMEDIATE_B64,
  TEST_ROOT_B64,
} from "./apple-signed-data.fixtures";
import type { PushMessage } from "./push-notify.server";

/* -------------------------------------------------------------------------- */
/* An in-memory Supabase-shaped fake: select/eq/is/in/maybeSingle, insert     */
/* with a unique index, update/delete with filters, and upsert on a key.      */
/* -------------------------------------------------------------------------- */

type Row = Record<string, any>;
type Admin = Parameters<typeof handleAppStoreNotification>[0];

const UNIQUE: Record<string, string[]> = {
  webhook_receipts: ["source", "external_id"],
  app_store_app_transactions: ["app_transaction_id", "environment", "athlete_id"],
  app_store_rescinded_transactions: ["app_transaction_id", "environment"],
};

function fakeAdmin(seed: Record<string, Row[]>, opts: { failUpdatesOn?: string } = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));

  function from(table: string) {
    const st = {
      filters: [] as Array<(r: Row) => boolean>,
      mode: "select" as "select" | "insert" | "update" | "delete" | "upsert",
      payload: null as any,
    };
    const exec = (): { data: any; error: any } => {
      tables[table] ??= [];
      const uk = UNIQUE[table];
      const clash = (r: Row) => tables[table].find((ex) => uk?.every((k) => ex[k] === r[k]));
      if (st.mode === "insert") {
        const rows: Row[] = Array.isArray(st.payload) ? st.payload : [st.payload];
        if (uk && rows.some((r) => clash(r))) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        tables[table].push(...rows.map((r) => ({ ...r })));
        return { data: rows, error: null };
      }
      if (st.mode === "upsert") {
        const r = st.payload as Row;
        const existing = clash(r);
        if (existing) Object.assign(existing, r);
        else tables[table].push({ first_seen_at: r.last_seen_at, ...r });
        return { data: null, error: null };
      }
      const rows = tables[table].filter((r) => st.filters.every((f) => f(r)));
      if (st.mode === "update") {
        if (opts.failUpdatesOn === table) return { data: null, error: { message: "boom" } };
        for (const r of rows) Object.assign(r, st.payload);
        return { data: rows, error: null };
      }
      if (st.mode === "delete") {
        tables[table] = tables[table].filter((r) => !rows.includes(r));
        return { data: rows, error: null };
      }
      return { data: rows, error: null };
    };
    const api: any = {
      select: () => api,
      insert: (p: any) => ((st.mode = "insert"), (st.payload = p), api),
      update: (p: any) => ((st.mode = "update"), (st.payload = p), api),
      upsert: (p: any) => ((st.mode = "upsert"), (st.payload = p), api),
      delete: () => ((st.mode = "delete"), api),
      eq: (c: string, v: unknown) => (st.filters.push((r) => r[c] === v), api),
      is: (c: string, v: unknown) => (st.filters.push((r) => (r[c] ?? null) === v), api),
      in: (c: string, vs: unknown[]) => (st.filters.push((r) => vs.includes(r[c])), api),
      maybeSingle: async () => {
        const res = exec();
        return res.error ? res : { data: res.data[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(resolve, reject),
    };
    return api;
  }
  return { from, tables } as unknown as Admin & { tables: Record<string, Row[]> };
}

/* -------------------------------------------------------------------------- */

const NOW = new Date("2027-03-01T12:00:00Z");
const SIGNED = NOW.getTime() - 60_000;
const BUNDLE = "training.gradus.app";
const ATHLETE = "aaaaaaaa-0000-4000-8000-000000000001";
const SIBLING = "aaaaaaaa-0000-4000-8000-000000000002";
const PARENT = "pppppppp-0000-4000-8000-000000000001";
const PARENT_USER = "uuuuuuuu-0000-4000-8000-00000000000a";
const ATHLETE_USER = "uuuuuuuu-0000-4000-8000-00000000000b";
const COACH = "cccccccc-0000-4000-8000-000000000001";
const COACH_USER = "uuuuuuuu-0000-4000-8000-00000000000c";
const DOWNLOAD = "704283728740938457";

function seed() {
  return {
    athletes: [
      {
        id: ATHLETE,
        user_id: ATHLETE_USER,
        parent_id: PARENT,
        first_name: "Ava",
        account_state: "active",
      },
      { id: SIBLING, user_id: null, parent_id: PARENT, first_name: "Ben", account_state: "active" },
    ],
    parent_profiles: [{ id: PARENT, user_id: PARENT_USER, subscription_status: null }],
    coach_profiles: [{ id: COACH, user_id: COACH_USER }],
    coach_athletes: [{ athlete_id: ATHLETE, coach_id: COACH }],
    guardian_consents: [
      { id: "g1", athlete_id: ATHLETE, parent_id: PARENT, scope: "account", revoked_at: null },
      { id: "g2", athlete_id: ATHLETE, parent_id: PARENT, scope: "messaging", revoked_at: null },
      { id: "g3", athlete_id: SIBLING, parent_id: PARENT, scope: "account", revoked_at: null },
    ],
    app_store_app_transactions: [
      { app_transaction_id: DOWNLOAD, environment: "Sandbox", athlete_id: ATHLETE },
    ],
    webhook_receipts: [],
  };
}

function recorder() {
  const sent: { userIds: string[]; message: PushMessage }[] = [];
  const notify = (async (_admin: unknown, userIds: Iterable<string>, message: PushMessage) => {
    sent.push({ userIds: Array.from(userIds), message });
    return { recipients: 0, tokens: 0, sent: 0, failed: 0, pruned: 0 };
  }) as unknown as NonNullable<AppStoreDeps["notify"]>;
  return { sent, notify };
}

const appTransaction = (overrides: Record<string, unknown> = {}) =>
  signTestJws({
    appTransactionId: DOWNLOAD,
    bundleId: BUNDLE,
    receiptType: "Sandbox",
    receiptCreationDate: SIGNED,
    originalApplicationVersion: "1",
    ...overrides,
  });

async function notification(
  overrides: Record<string, unknown> = {},
  appData: Record<string, unknown> = {},
) {
  return signTestJws({
    notificationType: "RESCIND_CONSENT",
    notificationUUID: "11111111-2222-4333-8444-555555555555",
    version: "2.0",
    signedDate: SIGNED,
    appData: {
      bundleId: BUNDLE,
      environment: "Sandbox",
      signedAppTransactionInfo: await appTransaction(),
      ...appData,
    },
    ...overrides,
  });
}

const post = (body: unknown) =>
  new Request("https://gradus.training/api/public/webhooks/app-store", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const deps = (notify: AppStoreDeps["notify"]): AppStoreDeps => ({
  roots: TEST_ROOTS,
  now: NOW,
  env: {} as NodeJS.ProcessEnv,
  notify,
});

describe("POST /api/public/webhooks/app-store — RESCIND_CONSENT", () => {
  it("pauses the bound athlete, revokes their consent, and tells the family and the coach", async () => {
    const admin = fakeAdmin(seed());
    const { sent, notify } = recorder();
    const res = await handleAppStoreNotification(
      admin,
      post({ signedPayload: await notification() }),
      deps(notify),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, paused: 1, revoked: 2 });

    const ava = admin.tables.athletes.find((a) => a.id === ATHLETE)!;
    expect(ava.account_state).toBe("paused");
    const avaConsents = admin.tables.guardian_consents.filter((c) => c.athlete_id === ATHLETE);
    expect(avaConsents.every((c) => c.revoked_reason === RESCIND_CONSENT_REASON)).toBe(true);
    // Ben was never bound to this download.
    expect(admin.tables.athletes.find((a) => a.id === SIBLING)!.account_state).toBe("active");
    expect(admin.tables.guardian_consents.find((c) => c.id === "g3")!.revoked_at).toBeNull();

    expect(sent).toHaveLength(2);
    expect(sent[0].userIds).toEqual([PARENT_USER]);
    expect(sent[0].message).toMatchObject({
      type: "consent_rescinded",
      route: "settings/athletes",
    });
    expect(sent[0].message.title).toBe("Ava's Gradus account is paused");
    expect(sent[1].userIds).toEqual([COACH_USER]);
    expect(sent[1].message).toMatchObject({ type: "consent_rescinded", route: "coach/roster" });

    expect(admin.tables.webhook_receipts).toHaveLength(1);
    expect(admin.tables.webhook_receipts[0]).toMatchObject({
      source: "app_store",
      event: "RESCIND_CONSENT",
    });
  });

  it("pauses every athlete who used the download (siblings on one iPad)", async () => {
    const s = seed();
    s.app_store_app_transactions.push({
      app_transaction_id: DOWNLOAD,
      environment: "Sandbox",
      athlete_id: SIBLING,
    });
    const admin = fakeAdmin(s);
    const res = await handleAppStoreNotification(
      admin,
      post({ signedPayload: await notification() }),
      deps(recorder().notify),
    );
    expect((await res.json()).paused).toBe(2);
  });

  it("treats a retried delivery as a duplicate and changes nothing twice", async () => {
    const admin = fakeAdmin(seed());
    const { sent, notify } = recorder();
    const body = { signedPayload: await notification() };
    await handleAppStoreNotification(admin, post(body), deps(notify));
    const again = await handleAppStoreNotification(admin, post(body), deps(notify));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(sent).toHaveLength(2);
  });

  it("does not match a sandbox download against a production binding", async () => {
    const s = seed();
    s.app_store_app_transactions[0].environment = "Production";
    const admin = fakeAdmin(s);
    const res = await handleAppStoreNotification(
      admin,
      post({ signedPayload: await notification() }),
      deps(recorder().notify),
    );
    expect(await res.json()).toEqual({ ok: true, paused: 0, revoked: 0 });
    expect(admin.tables.athletes[0].account_state).toBe("active");
  });

  it("writes no receipt when applying fails, so Apple's retry applies it and tells everyone", async () => {
    const opts: { failUpdatesOn?: string } = { failUpdatesOn: "athletes" };
    const admin = fakeAdmin(seed(), opts);
    const { sent, notify } = recorder();
    const body = { signedPayload: await notification() };
    let threw = false;
    try {
      await handleAppStoreNotification(admin, post(body), deps(notify));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(admin.tables.webhook_receipts).toHaveLength(0);
    expect(sent).toHaveLength(0);

    opts.failUpdatesOn = undefined; // the database is back; Apple retries
    const retry = await handleAppStoreNotification(admin, post(body), deps(notify));
    expect(await retry.json()).toEqual({ ok: true, paused: 1, revoked: 2 });
    expect(admin.tables.webhook_receipts).toHaveLength(1);
    expect(sent.map((p) => p.userIds)).toEqual([[PARENT_USER], [COACH_USER]]);
  });

  it("remembers a rescind that arrives before the athlete is bound, and pauses them at binding", async () => {
    const s = seed();
    s.app_store_app_transactions = [];
    const admin = fakeAdmin(s);
    const { sent, notify } = recorder();
    const res = await handleAppStoreNotification(
      admin,
      post({ signedPayload: await notification() }),
      deps(notify),
    );
    expect(await res.json()).toEqual({ ok: true, paused: 0, revoked: 0 });
    expect(admin.tables.app_store_rescinded_transactions).toHaveLength(1);
    expect(admin.tables.athletes[0].account_state).toBe("active");

    // The child signs in on that download for the first time.
    const input = { signedAppTransaction: await appTransaction() };
    expect(await registerAppTransaction(admin, ATHLETE_USER, input, deps(notify))).toEqual({
      ok: true,
      bound: true,
    });
    expect(admin.tables.athletes[0].account_state).toBe("paused");
    expect(
      admin.tables.guardian_consents.filter((c) => c.athlete_id === ATHLETE && !c.revoked_at),
    ).toHaveLength(0);
    expect(sent).toHaveLength(2);

    // The weekly re-report changes nothing and sends nothing.
    await registerAppTransaction(admin, ATHLETE_USER, input, deps(notify));
    expect(sent).toHaveLength(2);
  });

  it("refuses a notification that does not chain to the trusted root", async () => {
    const admin = fakeAdmin(seed());
    const res = await handleAppStoreNotification(
      admin,
      post({ signedPayload: await notification() }),
      { ...deps(recorder().notify), roots: undefined }, // the real Apple root
    );
    expect(res.status).toBe(401);
    expect(admin.tables.athletes[0].account_state).toBe("active");
  });

  it("refuses a notification signed with a developer's own certificate", async () => {
    const admin = fakeAdmin(seed());
    const forged = await signTestJws(
      {
        notificationType: "RESCIND_CONSENT",
        notificationUUID: "forged",
        signedDate: SIGNED,
        appData: {
          bundleId: BUNDLE,
          environment: "Sandbox",
          signedAppTransactionInfo: await appTransaction(),
        },
      },
      { x5c: [TEST_DEVELOPER_LEAF_B64, TEST_INTERMEDIATE_B64, TEST_ROOT_B64] },
    );
    const res = await handleAppStoreNotification(
      admin,
      post({ signedPayload: forged }),
      deps(recorder().notify),
    );
    expect(res.status).toBe(401);
    expect(admin.tables.athletes[0].account_state).toBe("active");
  });

  it("refuses a genuine notification carrying a forged app transaction", async () => {
    const admin = fakeAdmin(seed());
    const forgedTx = await signTestJws(
      { appTransactionId: DOWNLOAD, bundleId: BUNDLE, receiptType: "Sandbox" },
      { x5c: [TEST_DEVELOPER_LEAF_B64, TEST_INTERMEDIATE_B64, TEST_ROOT_B64] },
    );
    const res = await handleAppStoreNotification(
      admin,
      post({ signedPayload: await notification({}, { signedAppTransactionInfo: forgedTx }) }),
      deps(recorder().notify),
    );
    expect(res.status).toBe(401);
  });

  it("ignores a notification for another app", async () => {
    const admin = fakeAdmin(seed());
    const res = await handleAppStoreNotification(
      admin,
      post({ signedPayload: await notification({}, { bundleId: "com.example.other" }) }),
      deps(recorder().notify),
    );
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(admin.tables.athletes[0].account_state).toBe("active");
  });

  it("ignores an app transaction whose environment disagrees with the notification", async () => {
    const admin = fakeAdmin(seed());
    const res = await handleAppStoreNotification(
      admin,
      post({ signedPayload: await notification({}, { environment: "Production" }) }),
      deps(recorder().notify),
    );
    expect(await res.json()).toEqual({ ok: true, ignored: true });
  });

  it("acknowledges and ignores every other notification type", async () => {
    const admin = fakeAdmin(seed());
    const res = await handleAppStoreNotification(
      admin,
      post({
        signedPayload: await signTestJws({
          notificationType: "TEST",
          notificationUUID: "t1",
          signedDate: SIGNED,
          data: { bundleId: BUNDLE, environment: "Sandbox" },
        }),
      }),
      deps(recorder().notify),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(admin.tables.webhook_receipts).toHaveLength(0);
  });

  it("answers 400 to a body that is not a notification", async () => {
    const admin = fakeAdmin(seed());
    for (const body of ["not json", {}, { signedPayload: 7 }]) {
      const res = await handleAppStoreNotification(admin, post(body), deps(recorder().notify));
      expect(res.status).toBe(400);
    }
  });
});

describe("registerAppTransaction (POST /api/v1/me/app-transaction)", () => {
  it("binds the signed-in athlete to the download, once", async () => {
    const s = seed();
    s.app_store_app_transactions = [];
    const admin = fakeAdmin(s);
    const input = { signedAppTransaction: await appTransaction() };
    expect(await registerAppTransaction(admin, ATHLETE_USER, input, deps(undefined))).toEqual({
      ok: true,
      bound: true,
    });
    await registerAppTransaction(admin, ATHLETE_USER, input, deps(undefined));
    expect(admin.tables.app_store_app_transactions).toHaveLength(1);
    expect(admin.tables.app_store_app_transactions[0]).toMatchObject({
      app_transaction_id: DOWNLOAD,
      environment: "Sandbox",
      athlete_id: ATHLETE,
    });
  });

  it("never binds a coach or a parent", async () => {
    const s = seed();
    s.app_store_app_transactions = [];
    const admin = fakeAdmin(s);
    const out = await registerAppTransaction(
      admin,
      PARENT_USER,
      { signedAppTransaction: await appTransaction() },
      deps(undefined),
    );
    expect(out).toEqual({ ok: true, bound: false });
    expect(admin.tables.app_store_app_transactions).toHaveLength(0);
  });

  it("skips another app's transaction and Xcode's local signing", async () => {
    const s = seed();
    s.app_store_app_transactions = [];
    const admin = fakeAdmin(s);
    for (const overrides of [{ bundleId: "com.example.other" }, { receiptType: "Xcode" }]) {
      const out = await registerAppTransaction(
        admin,
        ATHLETE_USER,
        { signedAppTransaction: await appTransaction(overrides) },
        deps(undefined),
      );
      expect(out.bound).toBe(false);
    }
    expect(admin.tables.app_store_app_transactions).toHaveLength(0);
  });

  it("answers 422 to a transaction that does not verify", async () => {
    const admin = fakeAdmin(seed());
    let error: unknown;
    try {
      await registerAppTransaction(
        admin,
        ATHLETE_USER,
        { signedAppTransaction: await appTransaction() },
        { ...deps(undefined), roots: undefined },
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("invalid_app_transaction");
  });
});
