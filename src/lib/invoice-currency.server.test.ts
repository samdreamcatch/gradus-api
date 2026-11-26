import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  getInvoiceCurrency,
  getInvoiceCurrencyOrFail,
  resetInvoiceCurrencyWarning,
  setInvoiceCurrency,
  setInvoiceCurrencyInput,
} from "./invoice-currency.server";
import { INVOICE_CURRENCY_CODES } from "./invoice-currency";

type CoachRow = { id: string; user_id: string; invoice_currency?: string };
type DbError = { code: string; message: string };

const WREN_USER = "11111111-1111-4111-8111-111111111111";
const WREN_COACH = "22222222-2222-4222-8222-222222222222";
const ODETTE_USER = "33333333-3333-4333-8333-333333333333";
const ODETTE_COACH = "44444444-4444-4444-8444-444444444444";

/**
 * Just the `coach_profiles` calls the module makes: `select().eq().maybeSingle()`
 * and `update().eq().eq().select().maybeSingle()`. `missingColumn` behaves like
 * the database before migration 20261121120000: a select naming
 * `invoice_currency` fails with Postgres 42703, an update naming it with
 * PostgREST's PGRST204. Test-only.
 */
function fakeClient(
  rows: CoachRow[],
  opts: { missingColumn?: boolean; readError?: DbError; throwOnRead?: boolean } = {},
) {
  const log: Array<{ op: "select" | "update"; columns?: string; filters: [string, unknown][] }> =
    [];
  const matching = (filters: [string, unknown][]) =>
    rows.filter((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
  const client = {
    from(table: string) {
      if (table !== "coach_profiles") throw new Error(`unexpected table ${table}`);
      return {
        select(columns: string) {
          const filters: [string, unknown][] = [];
          const q = {
            eq(c: string, v: unknown) {
              filters.push([c, v]);
              return q;
            },
            async maybeSingle() {
              log.push({ op: "select", columns, filters });
              if (opts.throwOnRead) throw new TypeError("fetch failed");
              if (opts.readError) return { data: null, error: opts.readError };
              if (opts.missingColumn && columns.includes("invoice_currency")) {
                return {
                  data: null,
                  error: {
                    code: "42703",
                    message: "column coach_profiles.invoice_currency does not exist",
                  },
                };
              }
              return { data: matching(filters)[0] ?? null, error: null };
            },
          };
          return q;
        },
        update(patch: Partial<CoachRow>) {
          const filters: [string, unknown][] = [];
          const q = {
            eq(c: string, v: unknown) {
              filters.push([c, v]);
              return q;
            },
            select() {
              return q;
            },
            async maybeSingle() {
              log.push({ op: "update", filters });
              if (opts.missingColumn && "invoice_currency" in patch) {
                return {
                  data: null,
                  error: {
                    code: "PGRST204",
                    message:
                      "Could not find the 'invoice_currency' column of 'coach_profiles' in the schema cache",
                  },
                };
              }
              const hit = matching(filters)[0];
              if (hit) Object.assign(hit, patch);
              return { data: hit ?? null, error: null };
            },
          };
          return q;
        },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, log };
}

const twoCoaches = (): CoachRow[] => [
  { id: WREN_COACH, user_id: WREN_USER, invoice_currency: "USD" },
  { id: ODETTE_COACH, user_id: ODETTE_USER, invoice_currency: "USD" },
];

/**
 * Runs `fn` with `console.error` and `console.warn` silenced, and says how
 * often errors were logged and what was warned.
 */
async function quietly<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; logged: number; warned: string[] }> {
  const realError = console.error;
  const realWarn = console.warn;
  let logged = 0;
  const warned: string[] = [];
  console.error = () => {
    logged += 1;
  };
  console.warn = (...args: unknown[]) => {
    warned.push(args.map(String).join(" "));
  };
  try {
    return { result: await fn(), logged, warned };
  } finally {
    console.error = realError;
    console.warn = realWarn;
  }
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

describe("getInvoiceCurrency", () => {
  it("returns the coach's stored code, read with its own one-column query", async () => {
    const rows = twoCoaches();
    rows[0]!.invoice_currency = "GBP";
    const { client, log } = fakeClient(rows);

    expect(await getInvoiceCurrency(client, WREN_USER)).toBe("GBP");
    expect(await getInvoiceCurrency(client, ODETTE_USER)).toBe("USD");
    expect(log[0]).toEqual({
      op: "select",
      columns: "invoice_currency",
      filters: [["user_id", WREN_USER]],
    });
  });

  it("passes through a code this build does not know", async () => {
    const { client } = fakeClient([
      { id: WREN_COACH, user_id: WREN_USER, invoice_currency: "CHF" },
    ]);
    expect(await getInvoiceCurrency(client, WREN_USER)).toBe("CHF");
  });

  it("is undefined, never USD, for an account with no coach row", async () => {
    const { client } = fakeClient(twoCoaches());
    expect(
      await getInvoiceCurrency(client, "55555555-5555-4555-8555-555555555555"),
    ).toBeUndefined();
  });

  it("is undefined while the column is missing (both error codes): a warning naming the migration, not an error", async () => {
    const postgres = fakeClient(twoCoaches(), { missingColumn: true });
    const schemaCache = fakeClient(twoCoaches(), {
      readError: { code: "PGRST204", message: "schema cache" },
    });
    for (const { client } of [postgres, schemaCache]) {
      resetInvoiceCurrencyWarning();
      const { result, logged, warned } = await quietly(() => getInvoiceCurrency(client, WREN_USER));
      expect(result).toBeUndefined();
      expect(logged).toBe(0);
      // A migration that is never applied leaves a trace in the server log.
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain("20261121120000");
    }
  });

  it("warns once, not on every read, while the column is missing", async () => {
    resetInvoiceCurrencyWarning();
    const { client } = fakeClient(twoCoaches(), { missingColumn: true });
    const { warned, logged } = await quietly(async () => {
      expect(await getInvoiceCurrency(client, WREN_USER)).toBeUndefined();
      expect(await getInvoiceCurrency(client, ODETTE_USER)).toBeUndefined();
      expect(await getInvoiceCurrencyOrFail(client, WREN_USER)).toBeNull();
    });
    expect(warned).toHaveLength(1);
    expect(logged).toBe(0);
  });

  it("warns about nothing when the column is there", async () => {
    const { client } = fakeClient(twoCoaches());
    const { warned, logged } = await quietly(async () => {
      await getInvoiceCurrency(client, WREN_USER);
      await getInvoiceCurrency(client, "55555555-5555-4555-8555-555555555555");
    });
    expect(warned).toEqual([]);
    expect(logged).toBe(0);
  });

  it("is undefined, and logs, when the read fails for any other reason", async () => {
    const { client } = fakeClient(twoCoaches(), {
      readError: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    const { result, logged } = await quietly(() => getInvoiceCurrency(client, WREN_USER));
    expect(result).toBeUndefined();
    expect(logged).toBe(1);
  });

  it("never throws: a client that rejects reads as undefined", async () => {
    const { client } = fakeClient(twoCoaches(), { throwOnRead: true });
    const { result, logged } = await quietly(() => getInvoiceCurrency(client, WREN_USER));
    expect(result).toBeUndefined();
    expect(logged).toBe(1);
  });

  it("is undefined for an empty or non-text value", async () => {
    const { client } = fakeClient([{ id: WREN_COACH, user_id: WREN_USER, invoice_currency: "" }]);
    expect(await getInvoiceCurrency(client, WREN_USER)).toBeUndefined();
    const { client: absent } = fakeClient([{ id: WREN_COACH, user_id: WREN_USER }]);
    expect(await getInvoiceCurrency(absent, WREN_USER)).toBeUndefined();
  });
});

/*
 * The web invoicing screens' read. Unlike `/me`, it must tell "nothing to
 * show" (answered, and cached by the screens) from "the read failed" (thrown,
 * so the screens retry and never keep US dollars for a pound coach).
 */
describe("getInvoiceCurrencyOrFail", () => {
  it("answers the stored code", async () => {
    const rows = twoCoaches();
    rows[0]!.invoice_currency = "GBP";
    const { client } = fakeClient(rows);
    expect(await getInvoiceCurrencyOrFail(client, WREN_USER)).toBe("GBP");
  });

  it("answers null, without throwing, for an account with no coach row", async () => {
    const { client } = fakeClient(twoCoaches());
    expect(
      await getInvoiceCurrencyOrFail(client, "55555555-5555-4555-8555-555555555555"),
    ).toBeNull();
  });

  it("answers null, without throwing, while the column is missing", async () => {
    const { client } = fakeClient(twoCoaches(), { missingColumn: true });
    const { result } = await quietly(() => getInvoiceCurrencyOrFail(client, WREN_USER));
    expect(result).toBeNull();
  });

  it("throws when the read fails, so a failure is never answered as 'no currency'", async () => {
    const timedOut = fakeClient(twoCoaches(), {
      readError: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    const offline = fakeClient(twoCoaches(), { throwOnRead: true });
    for (const { client } of [timedOut, offline]) {
      const { result, logged } = await quietly(() =>
        getInvoiceCurrencyOrFail(client, WREN_USER).then(
          () => "answered",
          (err: unknown) => err,
        ),
      );
      expect(result).toBeInstanceOf(Error);
      // Nothing about the database reaches the browser.
      expect((result as Error).message).toBe("Couldn't load your invoice currency.");
      expect(logged).toBe(1);
    }
  });
});

describe("setInvoiceCurrencyInput", () => {
  it("accepts exactly the five codes", () => {
    expect([...INVOICE_CURRENCY_CODES]).toEqual(["USD", "CAD", "AUD", "NZD", "GBP"]);
    for (const currency of INVOICE_CURRENCY_CODES) {
      expect(setInvoiceCurrencyInput.parse({ currency })).toEqual({ currency });
    }
    for (const currency of ["EUR", "usd", "", "US", null, 1, undefined]) {
      expect(setInvoiceCurrencyInput.safeParse({ currency }).success).toBe(false);
    }
    expect(setInvoiceCurrencyInput.safeParse({}).success).toBe(false);
  });
});

describe("setInvoiceCurrency", () => {
  it("saves the caller's own row and answers with the stored value", async () => {
    const rows = twoCoaches();
    const { client, log } = fakeClient(rows);

    const saved = await setInvoiceCurrency(
      { userId: WREN_USER, supabase: client },
      { currency: "GBP" },
    );

    expect(saved).toEqual({ invoiceCurrency: "GBP" });
    expect(rows).toEqual([
      { id: WREN_COACH, user_id: WREN_USER, invoice_currency: "GBP" },
      { id: ODETTE_COACH, user_id: ODETTE_USER, invoice_currency: "USD" },
    ]);
    // The write is pinned to the caller: their coach id and their user id.
    expect(log.find((l) => l.op === "update")?.filters).toEqual([
      ["id", WREN_COACH],
      ["user_id", WREN_USER],
    ]);
  });

  it("is naturally idempotent: saving the same code twice changes nothing more", async () => {
    const rows = twoCoaches();
    const { client } = fakeClient(rows);
    const ctx = { userId: WREN_USER, supabase: client };
    expect(await setInvoiceCurrency(ctx, { currency: "NZD" })).toEqual({ invoiceCurrency: "NZD" });
    expect(await setInvoiceCurrency(ctx, { currency: "NZD" })).toEqual({ invoiceCurrency: "NZD" });
    expect(rows[0]!.invoice_currency).toBe("NZD");
  });

  it("refuses an account with no coach row with 403 wrong_role, and writes nothing", async () => {
    const rows = twoCoaches();
    const { client, log } = fakeClient(rows);

    const err = await caught(() =>
      setInvoiceCurrency(
        { userId: "55555555-5555-4555-8555-555555555555", supabase: client },
        { currency: "GBP" },
      ),
    );

    expect(err?.status).toBe(403);
    expect(err?.code).toBe("wrong_role");
    expect(err?.message).toBe("This account is not a coach.");
    expect(log.some((l) => l.op === "update")).toBe(false);
    expect(rows.map((r) => r.invoice_currency)).toEqual(["USD", "USD"]);
  });

  it("answers 503 unavailable while the column is missing, never a silent success", async () => {
    const rows: CoachRow[] = [{ id: WREN_COACH, user_id: WREN_USER }];
    const { client } = fakeClient(rows, { missingColumn: true });

    const err = await caught(() =>
      setInvoiceCurrency({ userId: WREN_USER, supabase: client }, { currency: "GBP" }),
    );

    expect(err?.status).toBe(503);
    expect(err?.code).toBe("unavailable");
    expect(rows[0]).toEqual({ id: WREN_COACH, user_id: WREN_USER });
  });

  it("still refuses a non-coach with wrong_role while the column is missing", async () => {
    const { client } = fakeClient(twoCoaches(), { missingColumn: true });
    const err = await caught(() =>
      setInvoiceCurrency(
        { userId: "55555555-5555-4555-8555-555555555555", supabase: client },
        { currency: "GBP" },
      ),
    );
    expect(err?.code).toBe("wrong_role");
  });
});
