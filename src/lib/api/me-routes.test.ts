import { describe, expect, it } from "bun:test";
import type { ApiContext } from "./auth";
import { createApiRouteHandler } from "./define-route";
import { getMeRouteOptions } from "@/routes/api/v1/me/index";
import { putMeInvoiceCurrencyRouteOptions } from "@/routes/api/v1/me/invoice-currency";
import { resetInvoiceCurrencyWarning } from "@/lib/invoice-currency.server";

/* -------------------------------------------------------------------------- */
/* A small in-memory Supabase-shaped fake. Test-only.                          */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
type Tables = Record<string, Row[]>;

interface FakeOptions {
  /**
   * Columns the database does not have yet, per table: a select naming one
   * fails with Postgres 42703 and an update naming one with PostgREST's
   * PGRST204, as before migration 20261121120000.
   */
  missingColumns?: Record<string, string[]>;
  /** An error (or `"throw"`, a rejected call) for a read of this table naming this column. */
  failRead?: { table: string; column: string; with: DbError | "throw" };
}

/**
 * Enough of `.from(t).select().eq().in().limit().maybeSingle()`, a bare
 * awaited select, and `.update().eq().select().maybeSingle()` for the two
 * `/me` routes. A table that was not seeded is empty.
 */
function fakeDb(tables: Tables, opts: FakeOptions = {}) {
  const writes: Array<{ table: string; patch: Row; filters: [string, unknown][] }> = [];
  const selects: Array<{ table: string; columns: string }> = [];
  // Requests that have started and not answered yet, and the most at once.
  const load = { open: 0, peak: 0 };

  function from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: Array<(row: Row) => boolean> = [];
    const eqs: [string, unknown][] = [];
    let columns = "*";
    let patch: Row | null = null;
    const missing = opts.missingColumns?.[table] ?? [];
    const names = (column: string) => new RegExp(`\\b${column}\\b`).test(columns);

    // A request stays open for a tick, as one over the network does, so
    // requests started together are counted together.
    async function run(): Promise<{ data: Row[] | null; error: DbError | null }> {
      load.open += 1;
      load.peak = Math.max(load.peak, load.open);
      try {
        await Promise.resolve();
        return await answer();
      } finally {
        load.open -= 1;
      }
    }

    async function answer(): Promise<{ data: Row[] | null; error: DbError | null }> {
      if (patch) {
        const bad = missing.find((c) => c in patch!);
        if (bad) {
          return {
            data: null,
            error: {
              code: "PGRST204",
              message: `Could not find the '${bad}' column of '${table}' in the schema cache`,
            },
          };
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        writes.push({ table, patch, filters: eqs });
        for (const r of hit) Object.assign(r, patch);
        return { data: hit, error: null };
      }
      selects.push({ table, columns });
      const fail = opts.failRead;
      if (fail && fail.table === table && names(fail.column)) {
        if (fail.with === "throw") throw new TypeError("fetch failed");
        return { data: null, error: fail.with };
      }
      const bad = missing.find(names);
      if (bad) {
        return {
          data: null,
          error: { code: "42703", message: `column ${table}.${bad} does not exist` },
        };
      }
      return { data: rows.filter((r) => filters.every((f) => f(r))), error: null };
    }

    const api = {
      select(cols: string) {
        columns = cols;
        return api;
      },
      update(p: Row) {
        patch = p;
        return api;
      },
      eq(column: string, value: unknown) {
        eqs.push([column, value]);
        filters.push((r) => r[column] === value);
        return api;
      },
      in(column: string, values: unknown[]) {
        filters.push((r) => values.includes(r[column]));
        return api;
      },
      limit() {
        return api;
      },
      async maybeSingle() {
        const res = await run();
        return { data: res.data?.[0] ?? null, error: res.error };
      },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        run().then(resolve, reject);
      },
    };
    return api;
  }

  return { tables, writes, selects, load, client: { from } };
}

const WREN_USER = "11111111-1111-4111-8111-111111111111";
const WREN_COACH = "22222222-2222-4222-8222-222222222222";
const ODETTE_USER = "33333333-3333-4333-8333-333333333333";
const ODETTE_COACH = "44444444-4444-4444-8444-444444444444";
const ELSIE_USER = "55555555-5555-4555-8555-555555555555";
const ELSIE_ATHLETE = "66666666-6666-4666-8666-666666666666";

/**
 * Runs `fn` with `console.error` and `console.warn` silenced (the routes log
 * what they swallow); what was warned is added to `warned` when it is given.
 */
async function quietly<T>(fn: () => Promise<T>, warned?: string[]): Promise<T> {
  const real = console.error;
  const realWarn = console.warn;
  console.error = () => {};
  console.warn = (...args: unknown[]) => {
    warned?.push(args.map(String).join(" "));
  };
  try {
    return await fn();
  } finally {
    console.error = real;
    console.warn = realWarn;
  }
}

/* -------------------------------------------------------------------------- */
/* GET /api/v1/me                                                             */
/* -------------------------------------------------------------------------- */

async function getMe(userId: string, tables: Tables, opts: FakeOptions = {}) {
  process.env.API_V1_ENABLED = "true";
  const db = fakeDb(tables, opts);
  const admin = db.client as unknown as ApiContext["admin"];
  const ctx: ApiContext = { userId, supabase: {} as ApiContext["supabase"], admin };
  const { GET } = createApiRouteHandler(getMeRouteOptions(), {
    admin,
    authenticate: async () => ctx,
  });
  const warned: string[] = [];
  const res = await quietly(
    () =>
      GET!({
        request: new Request("https://gradus.training/api/v1/me", {
          headers: { authorization: "Bearer t" },
        }),
      }),
    warned,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, db, warned };
}

/** Whether a `/me` call read `coach_profiles.invoice_currency`. */
const readCurrency = (db: ReturnType<typeof fakeDb>) =>
  db.selects.some((s) => s.table === "coach_profiles" && /\binvoice_currency\b/.test(s.columns));

const onboardedCoach = (currency?: string): Tables => ({
  coach_profiles: [
    {
      id: WREN_COACH,
      user_id: WREN_USER,
      onboarded_at: "2026-09-01T00:00:00.000Z",
      ...(currency ? { invoice_currency: currency } : {}),
    },
  ],
  coach_levels: [{ coach_id: WREN_COACH, sport: "figure_skating" }],
});

describe("GET /api/v1/me invoiceCurrency", () => {
  it("carries the coach's invoice currency", async () => {
    const { status, body, db } = await getMe(WREN_USER, onboardedCoach("GBP"));

    expect(status).toBe(200);
    expect(body.role).toBe("coach");
    expect(body.invoiceCurrency).toBe("GBP");
    // Read with its own query; the coach read that decides the role is unchanged.
    expect(db.selects.filter((s) => s.table === "coach_profiles").map((s) => s.columns)).toEqual([
      "id, onboarded_at",
      "invoice_currency",
    ]);
  });

  it("carries it for a coach who has not finished onboarding", async () => {
    const tables = onboardedCoach("NZD");
    tables.coach_profiles![0]!.onboarded_at = null;
    const { body } = await getMe(WREN_USER, tables);
    expect(body).toMatchObject({
      role: "coach",
      onboardingComplete: false,
      invoiceCurrency: "NZD",
    });
  });

  it("omits it, and still answers, while the column is missing", async () => {
    const { status, body } = await quietly(() =>
      getMe(WREN_USER, onboardedCoach(), {
        missingColumns: { coach_profiles: ["invoice_currency"] },
      }),
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ role: "coach", onboardingComplete: true });
    expect(body.sports).toEqual(["figure_skating"]);
    expect("invoiceCurrency" in body).toBe(false);
  });

  it("never fails on the currency read: a database error or a rejected call leaves it out", async () => {
    for (const failure of [
      { code: "57014", message: "canceling statement due to statement timeout" },
      "throw" as const,
    ]) {
      const { status, body } = await getMe(WREN_USER, onboardedCoach("GBP"), {
        failRead: { table: "coach_profiles", column: "invoice_currency", with: failure },
      });
      expect(status).toBe(200);
      expect(body.role).toBe("coach");
      expect("invoiceCurrency" in body).toBe(false);
    }
  });

  it("still answers 500 when the coach read that decides the role fails", async () => {
    const { status, body } = await getMe(WREN_USER, onboardedCoach("GBP"), {
      failRead: {
        table: "coach_profiles",
        column: "onboarded_at",
        with: { code: "57014", message: "canceling statement due to statement timeout" },
      },
    });
    expect(status).toBe(500);
    expect((body.error as { code: string }).code).toBe("internal");
  });

  it("omits it for an athlete, even one with a leftover coach row that has a currency", async () => {
    const { status, body } = await getMe(ELSIE_USER, {
      athletes: [{ id: ELSIE_ATHLETE, user_id: ELSIE_USER, account_state: "active" }],
      // Never onboarded: the athlete profile wins the role.
      coach_profiles: [
        { id: ODETTE_COACH, user_id: ELSIE_USER, onboarded_at: null, invoice_currency: "GBP" },
      ],
    });

    expect(status).toBe(200);
    expect(body.role).toBe("athlete");
    expect("invoiceCurrency" in body).toBe(false);
  });

  it("omits it for an org admin and for an account with no profile", async () => {
    const admin = await getMe(ODETTE_USER, { org_admins: [{ id: "oa-1", user_id: ODETTE_USER }] });
    expect(admin.body.role).toBe("org_admin");
    expect("invoiceCurrency" in admin.body).toBe(false);

    const nobody = await getMe(ODETTE_USER, {});
    expect(nobody.body.role).toBeNull();
    expect("invoiceCurrency" in nobody.body).toBe(false);
  });

  it("reads it for a coach only: no request for a parent, an athlete, an org admin or no profile", async () => {
    const others: Tables[] = [
      { parent_profiles: [{ id: "pp-1", user_id: ELSIE_USER }] },
      {
        athletes: [{ id: ELSIE_ATHLETE, user_id: ELSIE_USER, account_state: "active" }],
        coach_profiles: [
          { id: ODETTE_COACH, user_id: ELSIE_USER, onboarded_at: null, invoice_currency: "GBP" },
        ],
      },
      { org_admins: [{ id: "oa-1", user_id: ELSIE_USER }] },
      {},
    ];
    for (const tables of others) {
      const { status, db } = await getMe(ELSIE_USER, tables);
      expect(status).toBe(200);
      expect(readCurrency(db)).toBe(false);
    }

    const coach = await getMe(WREN_USER, onboardedCoach("GBP"));
    expect(readCurrency(coach.db)).toBe(true);
  });

  it("logs no missing-column warning for an account that is not a coach", async () => {
    resetInvoiceCurrencyWarning();
    const missing = { missingColumns: { coach_profiles: ["invoice_currency"] } };
    const athlete = await getMe(
      ELSIE_USER,
      { athletes: [{ id: ELSIE_ATHLETE, user_id: ELSIE_USER, account_state: "active" }] },
      missing,
    );
    expect(athlete.status).toBe(200);
    expect(athlete.warned).toEqual([]);

    // A coach's call still leaves the trace that the migration is not applied.
    const coach = await getMe(WREN_USER, onboardedCoach(), missing);
    expect(coach.warned).toHaveLength(1);
    expect(coach.warned[0]).toContain("20261121120000");
  });

  it("never has more than six requests open at once (a Worker queues the seventh)", async () => {
    const coach = await getMe(WREN_USER, onboardedCoach("GBP"));
    expect(coach.body.invoiceCurrency).toBe("GBP");
    expect(coach.db.load.peak).toBeLessThanOrEqual(6);

    const athlete = await getMe(ELSIE_USER, {
      athletes: [{ id: ELSIE_ATHLETE, user_id: ELSIE_USER, account_state: "active" }],
    });
    expect(athlete.db.load.peak).toBeLessThanOrEqual(6);
  });
});

/* -------------------------------------------------------------------------- */
/* PUT /api/v1/me/invoice-currency                                            */
/* -------------------------------------------------------------------------- */

const twoCoaches = (): Tables => ({
  coach_profiles: [
    { id: WREN_COACH, user_id: WREN_USER, invoice_currency: "USD" },
    { id: ODETTE_COACH, user_id: ODETTE_USER, invoice_currency: "USD" },
  ],
});

function putSetup(userId: string | null, tables: Tables, opts: FakeOptions = {}) {
  process.env.API_V1_ENABLED = "true";
  // The caller's user-scoped client: the only one the route may write through.
  const db = fakeDb(tables, opts);
  // The service-role client: must stay untouched.
  const adminDb = fakeDb({});
  const admin = adminDb.client as unknown as ApiContext["admin"];
  const ctx: ApiContext | null = userId
    ? { userId, supabase: db.client as unknown as ApiContext["supabase"], admin }
    : null;
  const { PUT } = createApiRouteHandler(putMeInvoiceCurrencyRouteOptions(), {
    admin,
    authenticate: async () => ctx,
  });
  const put = async (body?: unknown) => {
    const res = await quietly(() =>
      PUT!({
        request: new Request("https://gradus.training/api/v1/me/invoice-currency", {
          method: "PUT",
          headers: { authorization: "Bearer t", "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { put, db, adminDb };
}

const errorCode = (body: Record<string, unknown>) => (body.error as { code: string }).code;
const currencies = (tables: Tables) => tables.coach_profiles!.map((r) => r.invoice_currency);

describe("PUT /api/v1/me/invoice-currency", () => {
  it("saves each of the five codes and answers with the stored value", async () => {
    const tables = twoCoaches();
    const { put, db, adminDb } = putSetup(WREN_USER, tables);

    for (const currency of ["CAD", "AUD", "NZD", "GBP", "USD"]) {
      const res = await put({ currency });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ invoiceCurrency: currency });
      expect(currencies(tables)).toEqual([currency, "USD"]);
    }
    // Through the caller's own client (RLS applies), never the service role.
    expect(db.writes).toHaveLength(5);
    expect(adminDb.writes).toHaveLength(0);
    expect(adminDb.selects).toHaveLength(0);
  });

  it("answers 400 validation_failed for anything but the five codes, and writes nothing", async () => {
    const tables = twoCoaches();
    const { put, db } = putSetup(WREN_USER, tables);

    for (const body of [
      { currency: "EUR" },
      { currency: "gbp" },
      { currency: "" },
      { currency: null },
      { invoiceCurrency: "GBP" },
      {},
      undefined,
    ]) {
      const res = await put(body);
      expect(res.status).toBe(400);
      expect(errorCode(res.body)).toBe("validation_failed");
    }
    expect(db.writes).toHaveLength(0);
    expect(currencies(tables)).toEqual(["USD", "USD"]);
  });

  it("answers 401 without a session", async () => {
    const { put, db } = putSetup(null, twoCoaches());
    const res = await put({ currency: "GBP" });
    expect(res.status).toBe(401);
    expect(errorCode(res.body)).toBe("unauthenticated");
    expect(db.writes).toHaveLength(0);
  });

  it("answers 403 wrong_role to an account that is not a coach", async () => {
    const tables = twoCoaches();
    tables.athletes = [{ id: ELSIE_ATHLETE, user_id: ELSIE_USER }];
    const { put, db } = putSetup(ELSIE_USER, tables);

    const res = await put({ currency: "GBP" });

    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe("wrong_role");
    expect((res.body.error as { message: string }).message).toBe("This account is not a coach.");
    expect(db.writes).toHaveLength(0);
    expect(currencies(tables)).toEqual(["USD", "USD"]);
  });

  it("answers 503 unavailable while the column is missing", async () => {
    const tables: Tables = { coach_profiles: [{ id: WREN_COACH, user_id: WREN_USER }] };
    const { put } = putSetup(WREN_USER, tables, {
      missingColumns: { coach_profiles: ["invoice_currency"] },
    });

    const res = await put({ currency: "GBP" });

    expect(res.status).toBe(503);
    expect(errorCode(res.body)).toBe("unavailable");
    expect(tables.coach_profiles![0]).toEqual({ id: WREN_COACH, user_id: WREN_USER });
  });

  it("cannot write another coach's row: ids in the body are ignored and the write is pinned to the caller", async () => {
    const tables = twoCoaches();
    const { put, db } = putSetup(WREN_USER, tables);

    const res = await put({
      currency: "GBP",
      id: ODETTE_COACH,
      coachId: ODETTE_COACH,
      userId: ODETTE_USER,
      user_id: ODETTE_USER,
    });

    expect(res.status).toBe(200);
    expect(currencies(tables)).toEqual(["GBP", "USD"]);
    expect(db.writes).toEqual([
      {
        table: "coach_profiles",
        patch: { invoice_currency: "GBP" },
        filters: [
          ["id", WREN_COACH],
          ["user_id", WREN_USER],
        ],
      },
    ]);
  });
});
