import { describe, expect, it } from "bun:test";
import {
  DORMANT_NOTICE_DAYS,
  addDays,
  dormantCutoff,
  minorBirthdateFloor,
  emailLogCutoff,
  purgeEmailSendLog,
  purgeExpiredRecords,
  recordCutoff,
  sweepDormantMinorAthletes,
  type DormantSweepDeps,
  type RetentionNoticeArgs,
} from "./retention.server";

/* A Supabase-shaped fake covering the chains this module uses:
   select/eq/is/not/lt/gt/in/order(nullsFirst)/limit, update…eq,
   delete…lt…select, and auth.admin.getUserById with email, last_sign_in_at,
   and scripted errors. Unknown tables are empty. */

type Row = Record<string, any>;
type Admin = Parameters<typeof sweepDormantMinorAthletes>[0];
type FakeUser = {
  email?: string | null;
  last_sign_in_at?: string | null;
  error?: { status: number; message: string };
};

function fakeAdmin(seed: Record<string, Row[]>, users: Record<string, FakeUser> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const authCalls: string[] = [];

  function from(table: string) {
    const st = {
      filters: [] as Array<(r: Row) => boolean>,
      mode: "select" as "select" | "update" | "delete",
      payload: null as any,
      orders: [] as Array<{ col: string; asc: boolean; nullsFirst: boolean }>,
      limit: undefined as number | undefined,
    };
    const cmp = (a: Row, b: Row): number => {
      for (const { col, asc, nullsFirst } of st.orders) {
        const x = a[col] ?? null;
        const y = b[col] ?? null;
        if (x === y) continue;
        if (x === null) return nullsFirst ? -1 : 1;
        if (y === null) return nullsFirst ? 1 : -1;
        return (x < y ? -1 : 1) * (asc ? 1 : -1);
      }
      return 0;
    };
    const exec = (): { data: any; error: any } => {
      tables[table] ??= [];
      let rows = tables[table].filter((r) => st.filters.every((f) => f(r)));
      if (st.mode === "update") {
        for (const r of rows) Object.assign(r, st.payload);
        return { data: rows, error: null };
      }
      if (st.mode === "delete") {
        tables[table] = tables[table].filter((r) => !rows.includes(r));
        return { data: rows, error: null };
      }
      if (st.orders.length) rows = [...rows].sort(cmp);
      if (st.limit != null) rows = rows.slice(0, st.limit);
      return { data: rows, error: null };
    };
    const api: any = {
      select: () => api,
      update: (p: any) => ((st.mode = "update"), (st.payload = p), api),
      delete: () => ((st.mode = "delete"), api),
      eq: (c: string, v: unknown) => (st.filters.push((r) => r[c] === v), api),
      is: (c: string, v: unknown) => (st.filters.push((r) => (r[c] ?? null) === v), api),
      not: (c: string, op: string, v: unknown) => {
        if (op !== "is" || v !== null) throw new Error("fake supports not(col, 'is', null) only");
        st.filters.push((r) => (r[c] ?? null) !== null);
        return api;
      },
      lt: (c: string, v: any) => (st.filters.push((r) => r[c] != null && r[c] < v), api),
      lte: (c: string, v: any) => (st.filters.push((r) => r[c] != null && r[c] <= v), api),
      gt: (c: string, v: any) => (st.filters.push((r) => r[c] != null && r[c] > v), api),
      in: (c: string, vs: unknown[]) => (st.filters.push((r) => vs.includes(r[c])), api),
      order: (c: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => (
        st.orders.push({ col: c, asc: o?.ascending !== false, nullsFirst: o?.nullsFirst === true }),
        api
      ),
      limit: (n: number) => ((st.limit = n), api),
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
          authCalls.push(id);
          const u = users[id];
          if (u?.error) return { data: { user: null }, error: u.error };
          return {
            data: {
              user: u
                ? { id, email: u.email ?? null, last_sign_in_at: u.last_sign_in_at ?? null }
                : null,
            },
            error: u ? null : { status: 404, message: "User not found" },
          };
        },
      },
    },
    tables,
    authCalls,
  } as unknown as Admin & { tables: Record<string, Row[]>; authCalls: string[] };
}

const NOW = new Date("2026-10-04T12:00:00Z");
const iso = (d: Date) => d.toISOString();

function deps() {
  const calls: string[] = [];
  const notices: RetentionNoticeArgs[] = [];
  const d: DormantSweepDeps = {
    purgeAthlete: async (id) => void calls.push(`purge:${id}`),
    deleteAuthUser: async (id) => void calls.push(`auth:${id}`),
    recordDeletion: async ({ athleteId, userId }) =>
      void calls.push(`tomb:${athleteId}:${userId ?? "-"}`),
    sendNotice: async (a) => void notices.push(a),
  };
  return { d, calls, notices };
}

const minor = (extra: Row = {}) => ({
  id: "a1",
  user_id: "u-a1",
  parent_id: "p1",
  first_name: "Rory",
  birthdate: "2014-05-01",
  created_at: "2022-01-01T00:00:00Z",
  is_test: false,
  retention_notice_sent_at: null,
  retention_checked_at: null,
  guardian_email: null,
  ...extra,
});
const parent = (extra: Row = {}) => ({
  id: "p1",
  user_id: "u-p1",
  last_seen_at: "2023-01-01T00:00:00Z",
  ...extra,
});
const USERS: Record<string, FakeUser> = {
  "u-p1": { email: "Mom@Example.com", last_sign_in_at: "2023-01-01T00:00:00Z" },
  "u-a1": { email: null, last_sign_in_at: "2022-06-01T00:00:00Z" },
};

describe("cutoffs", () => {
  it("three years dormant, five years for records (month-clamped), eighteen for the birthdate floor", () => {
    expect(iso(dormantCutoff(NOW))).toBe("2023-10-04T12:00:00.000Z");
    expect(iso(recordCutoff(new Date("2028-02-29T00:00:00Z")))).toBe("2023-02-28T00:00:00.000Z");
    expect(minorBirthdateFloor(NOW)).toBe("2008-10-04");
    expect(iso(addDays(NOW, DORMANT_NOTICE_DAYS))).toBe("2026-11-03T12:00:00.000Z");
  });
});

describe("sweepDormantMinorAthletes", () => {
  it("notices every guardian, waits out the window plus a day of grace, then tombstones, purges, deletes auth", async () => {
    const admin = fakeAdmin({ athletes: [minor()], parent_profiles: [parent()] }, USERS);
    const { d, calls, notices } = deps();

    const first = await sweepDormantMinorAthletes(admin, { now: NOW, deps: d });
    expect(first).toMatchObject({ scanned: 1, noticed: 1, deleted: 0, waiting: 0, failed: 0 });
    expect(notices).toEqual([
      { to: "mom@example.com", athleteName: "Rory", deleteOn: addDays(NOW, 30) },
    ]);
    expect(admin.tables.athletes[0].retention_notice_sent_at).toBe(iso(NOW));
    expect(admin.tables.athletes[0].retention_checked_at).toBe(iso(NOW));
    expect(calls).toEqual([]);

    const day30 = await sweepDormantMinorAthletes(admin, { now: addDays(NOW, 30), deps: d });
    expect(day30).toMatchObject({ scanned: 1, waiting: 1, deleted: 0, noticed: 0 });
    expect(notices).toHaveLength(1);

    const day31 = await sweepDormantMinorAthletes(admin, { now: addDays(NOW, 31), deps: d });
    expect(day31).toMatchObject({ scanned: 1, deleted: 1, failed: 0 });
    expect(calls).toEqual(["tomb:a1:u-a1", "purge:a1", "auth:u-a1"]);
  });

  it("a parent-managed athlete with no login still leaves a tombstone", async () => {
    const admin = fakeAdmin(
      {
        athletes: [minor({ user_id: null, retention_notice_sent_at: iso(addDays(NOW, -40)) })],
        parent_profiles: [parent()],
      },
      USERS,
    );
    const { d, calls } = deps();
    expect(await sweepDormantMinorAthletes(admin, { now: NOW, deps: d })).toMatchObject({
      deleted: 1,
    });
    expect(calls).toEqual(["tomb:a1:-", "purge:a1"]);
  });

  it("activity after the notice cancels it", async () => {
    const admin = fakeAdmin(
      {
        athletes: [minor({ retention_notice_sent_at: iso(addDays(NOW, -5)) })],
        parent_profiles: [parent({ last_seen_at: iso(addDays(NOW, -1)) })],
      },
      USERS,
    );
    const { d, calls, notices } = deps();
    expect(await sweepDormantMinorAthletes(admin, { now: NOW, deps: d })).toMatchObject({
      scanned: 1,
      reactivated: 1,
      deleted: 0,
      noticed: 0,
    });
    expect(admin.tables.athletes[0].retention_notice_sent_at).toBeNull();
    expect(calls).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("the family's, the coach's, and the devices' activity all count", async () => {
    const recent = iso(addDays(NOW, -10));
    const cases: Array<[string, Row]> = [
      ["plan_sessions", { athlete_id: "a1", logged_at: recent }],
      ["athlete_goals", { athlete_id: "a1", updated_at: recent }],
      ["lesson_wrap_ups", { athlete_id: "a1", updated_at: recent }],
      ["pre_lesson_briefings", { athlete_id: "a1", updated_at: recent }],
      ["invoices", { athlete_id: "a1", updated_at: recent }],
      ["athlete_skill_events", { athlete_id: "a1", occurred_at: recent }],
      ["athlete_competition_results", { athlete_id: "a1", updated_at: recent }],
      ["competition_attendance", { athlete_id: "a1", first_seen_at: recent }],
      ["app_store_app_transactions", { athlete_id: "a1", last_seen_at: recent }],
      ["device_tokens", { user_id: "u-p1", last_seen_at: recent }],
    ];
    for (const [table, row] of cases) {
      const admin = fakeAdmin(
        { athletes: [minor()], parent_profiles: [parent()], [table]: [row] },
        USERS,
      );
      const { d, notices } = deps();
      const r = await sweepDormantMinorAthletes(admin, { now: NOW, deps: d });
      expect(r.noticed).toBe(0);
      expect(notices).toEqual([]);
    }
    const message = fakeAdmin(
      {
        athletes: [minor()],
        parent_profiles: [parent()],
        message_rooms: [{ id: "r1", athlete_id: "a1" }],
        messages: [{ room_id: "r1", created_at: recent }],
      },
      USERS,
    );
    expect((await sweepDormantMinorAthletes(message, { now: NOW, deps: deps().d })).noticed).toBe(
      0,
    );
  });

  it("notifies co-guardians, counts their sign-ins, and falls back to the guardian email on file", async () => {
    const both = fakeAdmin(
      {
        athletes: [minor()],
        parent_profiles: [parent(), { id: "p2", user_id: "u-p2", last_seen_at: null }],
        athlete_guardians: [{ athlete_id: "a1", parent_id: "p2" }],
      },
      { ...USERS, "u-p2": { email: "dad@example.com", last_sign_in_at: "2022-06-01T00:00:00Z" } },
    );
    const a = deps();
    await sweepDormantMinorAthletes(both, { now: NOW, deps: a.d });
    expect(a.notices.map((n) => n.to).sort()).toEqual(["dad@example.com", "mom@example.com"]);

    const active = fakeAdmin(
      {
        athletes: [minor()],
        parent_profiles: [parent(), { id: "p2", user_id: "u-p2", last_seen_at: null }],
        athlete_guardians: [{ athlete_id: "a1", parent_id: "p2" }],
      },
      { ...USERS, "u-p2": { email: "dad@example.com", last_sign_in_at: iso(addDays(NOW, -3)) } },
    );
    expect((await sweepDormantMinorAthletes(active, { now: NOW, deps: deps().d })).noticed).toBe(0);

    const onFile = fakeAdmin(
      { athletes: [minor({ parent_id: null, guardian_email: " Aunt@Example.com " })] },
      USERS,
    );
    const b = deps();
    expect(await sweepDormantMinorAthletes(onFile, { now: NOW, deps: b.d })).toMatchObject({
      noticed: 1,
    });
    expect(b.notices.map((n) => n.to)).toEqual(["aunt@example.com"]);
  });

  it("a failed auth lookup fails the row for tomorrow; it is never 'nobody to notify'", async () => {
    const admin = fakeAdmin(
      { athletes: [minor()], parent_profiles: [parent()] },
      { ...USERS, "u-p1": { error: { status: 503, message: "upstream unavailable" } } },
    );
    const { d, calls, notices } = deps();
    expect(await sweepDormantMinorAthletes(admin, { now: NOW, deps: d })).toMatchObject({
      scanned: 1,
      failed: 1,
      noticed: 0,
      deleted: 0,
      unnotifiable: 0,
    });
    expect(calls).toEqual([]);
    expect(notices).toEqual([]);
    expect(admin.tables.athletes[0].retention_notice_sent_at).toBeNull();
    expect(admin.tables.athletes[0].retention_checked_at).toBe(iso(NOW)); // a failing row rotates to the back
  });

  it("nobody to tell leaves the account alone and counts it", async () => {
    const gone = fakeAdmin(
      { athletes: [minor()], parent_profiles: [parent()] },
      { "u-a1": USERS["u-a1"] },
    );
    const { d, calls, notices } = deps();
    expect(await sweepDormantMinorAthletes(gone, { now: NOW, deps: d })).toMatchObject({
      unnotifiable: 1,
      deleted: 0,
      noticed: 0,
      failed: 0,
    });
    expect(calls).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("a notice that did not go out is never stamped", async () => {
    const admin = fakeAdmin({ athletes: [minor()], parent_profiles: [parent()] }, USERS);
    const { d, calls } = deps();
    d.sendNotice = async () => {
      throw new Error("queue down");
    };
    expect(await sweepDormantMinorAthletes(admin, { now: NOW, deps: d })).toMatchObject({
      failed: 1,
      noticed: 0,
    });
    expect(admin.tables.athletes[0].retention_notice_sent_at).toBeNull();
    expect(calls).toEqual([]);
  });

  it("adults, athletes with no birthdate, test accounts, and young accounts are out of scope", async () => {
    const admin = fakeAdmin(
      {
        athletes: [
          minor({ id: "adult", birthdate: "2000-01-01" }),
          minor({ id: "nodob", birthdate: null, guardian_email: "someone@example.com" }),
          minor({ id: "demo", is_test: true }),
          minor({ id: "young", created_at: iso(addDays(NOW, -400)) }),
        ],
        parent_profiles: [parent()],
      },
      USERS,
    );
    const { d, calls, notices } = deps();
    expect(await sweepDormantMinorAthletes(admin, { now: NOW, deps: d })).toMatchObject({
      scanned: 0,
    });
    expect(calls).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("takes the least recently checked candidates first and stamps each one examined", async () => {
    const admin = fakeAdmin(
      {
        athletes: [
          minor({
            id: "A",
            created_at: "2020-01-01T00:00:00Z",
            retention_checked_at: "2026-10-01T00:00:00Z",
          }),
          minor({ id: "B", created_at: "2021-01-01T00:00:00Z", retention_checked_at: null }),
          minor({
            id: "C",
            created_at: "2019-01-01T00:00:00Z",
            retention_checked_at: "2026-09-01T00:00:00Z",
          }),
        ],
        parent_profiles: [parent({ last_seen_at: iso(addDays(NOW, -1)) })],
      },
      USERS,
    );
    const { d } = deps();
    const r = await sweepDormantMinorAthletes(admin, { now: NOW, deps: d, limit: 2 });
    expect(r.scanned).toBe(2);
    const checked = Object.fromEntries(
      admin.tables.athletes.map((a) => [a.id, a.retention_checked_at]),
    );
    expect(checked.B).toBe(iso(NOW));
    expect(checked.C).toBe(iso(NOW));
    expect(checked.A).toBe("2026-10-01T00:00:00Z");
  });

  it("a pending notice for an athlete who has since turned 18 is cleared, never deleted", async () => {
    const admin = fakeAdmin(
      {
        athletes: [
          minor({ birthdate: "2008-09-20", retention_notice_sent_at: iso(addDays(NOW, -40)) }),
        ],
        parent_profiles: [parent()],
      },
      USERS,
    );
    const { d, calls } = deps();
    const r = await sweepDormantMinorAthletes(admin, { now: NOW, deps: d });
    expect(r).toMatchObject({ scanned: 1, deleted: 0, waiting: 0 });
    expect(admin.tables.athletes[0].retention_notice_sent_at).toBeNull();
    expect(admin.tables.athletes[0].retention_checked_at).toBe(iso(NOW));
    expect(calls).toEqual([]);
  });

  it("stops at the time budget and reports what it skipped", async () => {
    const admin = fakeAdmin(
      { athletes: [minor(), minor({ id: "a2" })], parent_profiles: [parent()] },
      USERS,
    );
    const { d, notices } = deps();
    const r = await sweepDormantMinorAthletes(admin, { now: NOW, deps: d, budgetMs: -1 });
    expect(r).toMatchObject({ scanned: 0, skipped: 2 });
    expect(notices).toEqual([]);
  });

  it("a failing purge is counted, not thrown, and the run continues", async () => {
    const stamped = iso(addDays(NOW, -40));
    const admin = fakeAdmin(
      {
        athletes: [
          minor({ id: "bad", retention_notice_sent_at: stamped }),
          minor({ id: "good", user_id: "u-good", retention_notice_sent_at: stamped }),
        ],
        parent_profiles: [parent()],
      },
      USERS,
    );
    const { d, calls } = deps();
    d.purgeAthlete = async (id) => {
      if (id === "bad") throw new Error("boom");
      calls.push(`purge:${id}`);
    };
    expect(await sweepDormantMinorAthletes(admin, { now: NOW, deps: d })).toMatchObject({
      scanned: 2,
      failed: 1,
      deleted: 1,
    });
    expect(calls).toEqual(["tomb:bad:u-a1", "tomb:good:u-good", "purge:good", "auth:u-good"]);
  });

  it("looks each auth user up once per run", async () => {
    const admin = fakeAdmin(
      { athletes: [minor(), minor({ id: "a2", user_id: null })], parent_profiles: [parent()] },
      USERS,
    );
    await sweepDormantMinorAthletes(admin, { now: NOW, deps: deps().d });
    expect(admin.authCalls.filter((u) => u === "u-p1")).toHaveLength(1);
  });
});

describe("purgeExpiredRecords", () => {
  it("deletes receipts and tombstones older than five years, keeps the rest", async () => {
    const admin = fakeAdmin({
      webhook_receipts: [
        { id: "old", received_at: "2020-01-01T00:00:00Z" },
        { id: "new", received_at: "2025-01-01T00:00:00Z" },
      ],
      deleted_accounts: [
        { id: "t-old", deleted_at: "2021-01-01T00:00:00Z" },
        { id: "t-new", deleted_at: "2026-01-01T00:00:00Z" },
      ],
    });
    expect(await purgeExpiredRecords(admin, { now: NOW })).toEqual({ receipts: 1, tombstones: 1 });
    expect(admin.tables.webhook_receipts.map((r) => r.id)).toEqual(["new"]);
    expect(admin.tables.deleted_accounts.map((r) => r.id)).toEqual(["t-new"]);
  });
});

describe("purgeEmailSendLog", () => {
  const row = (id: string, created_at: string) => ({ id, created_at, status: "sent" });

  it("cuts off thirteen months back, clamped like the other windows", () => {
    expect(emailLogCutoff(NOW).toISOString()).toBe("2025-09-04T12:00:00.000Z");
    // 2025-03-31 minus 13 months lands on 2024-02-29 at the latest; never rolls forward past it
    expect(emailLogCutoff(new Date("2026-03-31T00:00:00Z")).toISOString().slice(0, 10)).toBe(
      "2025-02-28",
    );
  });

  it("deletes delivery records older than thirteen months and keeps the rest", async () => {
    const admin = fakeAdmin({
      email_send_log: [
        row("old-1", "2024-01-01T00:00:00Z"),
        row("old-2", "2025-09-03T23:59:59Z"),
        row("edge", "2025-09-04T12:00:00Z"), // exactly the cutoff: kept
        row("new", "2026-09-01T00:00:00Z"),
      ],
    });
    expect(await purgeEmailSendLog(admin, { now: NOW })).toEqual({ deleted: 2, complete: true });
    expect(admin.tables.email_send_log.map((r) => r.id)).toEqual(["edge", "new"]);
  });

  it("walks a backlog in batches, oldest first, and counts every row", async () => {
    const old = Array.from({ length: 7 }, (_, i) => row(`o${i}`, `2024-0${i + 1}-01T00:00:00Z`));
    const admin = fakeAdmin({
      email_send_log: [...old, row("keep", "2026-09-01T00:00:00Z")],
    });
    const res = await purgeEmailSendLog(admin, { now: NOW, batchSize: 3 });
    expect(res).toEqual({ deleted: 7, complete: true });
    expect(admin.tables.email_send_log.map((r) => r.id)).toEqual(["keep"]);
  });

  it("stops at its time budget, reports incomplete, and finishes tomorrow", async () => {
    const old = Array.from({ length: 9 }, (_, i) => row(`o${i}`, `2024-01-0${i + 1}T00:00:00Z`));
    const admin = fakeAdmin({ email_send_log: old });
    const first = await purgeEmailSendLog(admin, { now: NOW, batchSize: 3, budgetMs: 0 });
    expect(first).toEqual({ deleted: 3, complete: false });
    expect(admin.tables.email_send_log).toHaveLength(6);
    const rest = await purgeEmailSendLog(admin, { now: NOW, batchSize: 3 });
    expect(rest).toEqual({ deleted: 6, complete: true });
  });

  it("does nothing when there is nothing old, and never touches other tables", async () => {
    const admin = fakeAdmin({
      email_send_log: [row("new", "2026-09-01T00:00:00Z")],
      webhook_receipts: [{ id: "r", received_at: "2020-01-01T00:00:00Z" }],
    });
    expect(await purgeEmailSendLog(admin, { now: NOW })).toEqual({ deleted: 0, complete: true });
    expect(admin.tables.webhook_receipts).toHaveLength(1);
  });

  it("surfaces a database error instead of reading it as 'nothing to delete'", async () => {
    const admin = {
      from: () => {
        const api: any = {};
        for (const m of ["select", "lt", "lte", "order", "limit", "delete"]) api[m] = () => api;
        api.then = (resolve: (v: unknown) => unknown) =>
          resolve({ data: null, error: { message: "boom", code: "XX000" } });
        return api;
      },
    } as unknown as Parameters<typeof purgeEmailSendLog>[0];
    let thrown = false;
    try {
      await purgeEmailSendLog(admin, { now: NOW });
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(true);
  });
});
