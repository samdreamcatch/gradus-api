import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { requireContext, type ApiContext } from "./api/auth";
import { createApiRouteHandler } from "./api/define-route";
import {
  athleteBillingSchema,
  createInvoiceResultSchema,
  invoiceDetailSchema,
  invoicePageSchema,
} from "./api/invoicing-schema";
import { addDays, parseIsoDate, toIsoDate } from "./lesson-recurrence";
import {
  createInvoice,
  createInvoiceInput,
  decodeInvoiceCursor,
  deleteInvoice,
  encodeInvoiceCursor,
  getAthleteBilling,
  getCoachInvoices,
  getCoachInvoicesPage,
  getInvoiceDetail,
  previewInvoice,
  setAthleteRate,
  setInvoiceStatus,
  type InvoicingContext,
} from "./invoicing.server";

/* -------------------------------------------------------------------------- */
/* A small, stateful, in-memory Supabase-shaped fake                          */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

type Filter =
  | { op: "eq" | "in" | "gte" | "lte"; col: string; val: unknown }
  | { op: "or"; preds: Array<(row: Row) => boolean> };

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    if (f.op === "or") return f.preds.some((p) => p(row));
    const rv = row[f.col];
    switch (f.op) {
      case "eq":
        return rv === f.val;
      case "in":
        return (f.val as unknown[]).includes(rv);
      case "gte":
        return (rv as string) >= (f.val as string);
      case "lte":
        return (rv as string) <= (f.val as string);
      default:
        return true;
    }
  });
}

/** Splits a PostgREST `or=` expression on top-level commas (parens-aware). */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function parseSimpleOrClause(clause: string): (row: Row) => boolean {
  const m = clause.match(/^([a-zA-Z_]+)\.(eq|neq|lt|gt|lte|gte)\.(.+)$/);
  if (!m) throw new Error(`unsupported or-clause: ${clause}`);
  const [, col, op, rawVal] = m;
  return (row) => {
    const rv = row[col!] as string;
    switch (op) {
      case "eq":
        return rv === rawVal;
      case "neq":
        return rv !== rawVal;
      case "lt":
        return rv < rawVal!;
      case "gt":
        return rv > rawVal!;
      case "lte":
        return rv <= rawVal!;
      case "gte":
        return rv >= rawVal!;
      default:
        return false;
    }
  };
}

function parseOrClause(clause: string): (row: Row) => boolean {
  if (clause.startsWith("and(") && clause.endsWith(")")) {
    const fns = splitTopLevel(clause.slice(4, -1)).map(parseSimpleOrClause);
    return (row) => fns.every((f) => f(row));
  }
  return parseSimpleOrClause(clause);
}

/**
 * A minimal, stateful in-memory stand-in for the Supabase query builder:
 * enough of `.select/.eq/.in/.gte/.lte/.or/.order/.limit` plus
 * `.insert/.upsert/.update/.delete` and `.maybeSingle/.single`/bare-await to
 * exercise invoicing.server.ts's real query shapes, including the
 * `invoice_lines(occurrence_date)` embed and the `(created_at, id)` cursor
 * `.or()`.
 */
function makeDb() {
  /**
   * Columns the database does not have yet, per table (a migration that is
   * not applied): a select naming one fails with Postgres 42703 (also the
   * columns an insert asks back, in which case nothing is inserted), an insert
   * naming one with PostgREST's PGRST204. Set after `makeDb()`.
   */
  const missingColumns: Record<string, string[]> = {};
  /**
   * What the database itself does to a row on insert, per table (a BEFORE
   * INSERT trigger): applied to the stored row after `inserts` has recorded
   * what the client sent. Set after `makeDb()`.
   */
  const insertTriggers: Record<string, (row: Row) => Row> = {};
  /** Every select string and insert payload that reached a table, in order. */
  const selects: Array<{ table: string; columns: string }> = [];
  const inserts: Array<{ table: string; rows: Row[] }> = [];
  const tables: Record<string, Row[]> = {
    coach_profiles: [],
    coach_athletes: [],
    coach_athlete_rates: [],
    athletes: [],
    invoices: [],
    invoice_lines: [],
    athlete_lesson_slots: [],
    lesson_slot_overrides: [],
    lesson_wrap_ups: [],
  };

  function builder(table: string) {
    const filters: Filter[] = [];
    const orderCols: Array<{ col: string; asc: boolean }> = [];
    let selectCols: string | null = null;
    let limitN: number | null = null;
    let mode: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let upsertConflict: string[] = [];

    /** The error a real database gives when this call names a column it lacks. */
    function missingColumnError(): { code: string; message: string } | null {
      const missing = missingColumns[table] ?? [];
      if (mode === "insert") {
        const rows = Array.isArray(payload) ? payload : [payload!];
        const bad = missing.find((c) => rows.some((r) => c in r));
        if (bad) {
          return {
            code: "PGRST204",
            message: `Could not find the '${bad}' column of '${table}' in the schema cache`,
          };
        }
        // No payload key is missing: fall through to the columns asked back
        // (INSERT ... RETURNING), which fail the whole statement the same way.
      }
      if ((mode !== "select" && mode !== "insert") || !selectCols) return null;
      const named = splitTopLevel(selectCols).map((s) => s.trim());
      const bad = missing.find((c) => named.includes(c));
      return bad ? { code: "42703", message: `column ${table}.${bad} does not exist` } : null;
    }

    /** Only the columns the select named (as PostgREST answers), plus embeds. */
    function project(row: Row): Row {
      if (!selectCols) return { ...row };
      const out: Row = {};
      for (const part of splitTopLevel(selectCols).map((s) => s.trim())) {
        const m = part.match(/^(\w+)\((.+)\)$/);
        if (!m) {
          if (part in row) out[part] = row[part];
          continue;
        }
        const [, relTable, relColsStr] = m;
        const relCols = relColsStr!.split(",").map((s) => s.trim());
        const relRows = tables[relTable!]!.filter((r) => r.invoice_id === row.id);
        out[relTable!] = relRows.map((r) => {
          const proj: Row = {};
          for (const c of relCols) proj[c] = r[c];
          return proj;
        });
      }
      return out;
    }

    function computeSelected(): Row[] {
      let rows = tables[table]!.filter((r) => matches(r, filters));
      for (const { col, asc } of [...orderCols].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = a[col] as string | number;
          const bv = b[col] as string | number;
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (asc ? 1 : -1);
        });
      }
      if (limitN != null) rows = rows.slice(0, limitN);
      return rows.map(project);
    }

    /** Records what the client sent, then stores the rows as the database keeps them. */
    function storeInserted(): Row[] {
      const rows = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({
        id: (r as Row).id ?? crypto.randomUUID(),
        ...(r as Row),
      }));
      inserts.push({ table, rows });
      const trigger = insertTriggers[table];
      const stored = trigger ? rows.map(trigger) : rows;
      tables[table]!.push(...stored);
      return stored;
    }

    const api = {
      select(cols: string) {
        selectCols = cols;
        if (mode === "select") selects.push({ table, columns: cols });
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push({ op: "eq", col, val });
        return api;
      },
      in(col: string, val: unknown) {
        filters.push({ op: "in", col, val });
        return api;
      },
      gte(col: string, val: unknown) {
        filters.push({ op: "gte", col, val });
        return api;
      },
      lte(col: string, val: unknown) {
        filters.push({ op: "lte", col, val });
        return api;
      },
      or(expr: string) {
        filters.push({ op: "or", preds: splitTopLevel(expr).map(parseOrClause) });
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCols.push({ col, asc: opts?.ascending !== false });
        return api;
      },
      limit(n: number) {
        limitN = n;
        return api;
      },
      insert(p: Row | Row[]) {
        mode = "insert";
        payload = p;
        return api;
      },
      upsert(p: Row, opts: { onConflict: string }) {
        mode = "upsert";
        payload = p;
        upsertConflict = opts.onConflict.split(",");
        return api;
      },
      update(p: Row) {
        mode = "update";
        payload = p;
        return api;
      },
      delete() {
        mode = "delete";
        return api;
      },
      async maybeSingle() {
        const refused = missingColumnError();
        if (refused) return { data: null, error: refused };
        if (mode === "insert") {
          const stored = storeInserted();
          return { data: stored[0] ? project(stored[0]) : null, error: null };
        }
        if (mode === "update") {
          const matched = tables[table]!.filter((r) => matches(r, filters));
          for (const r of matched) Object.assign(r, payload as Row);
          return { data: matched.length ? project(matched[0]!) : null, error: null };
        }
        const rows = computeSelected();
        return { data: rows[0] ?? null, error: null };
      },
      async single() {
        const res = await api.maybeSingle();
        if (res.error) return res;
        return res.data ? res : { data: null, error: { message: "no rows" } };
      },
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        const refused = missingColumnError();
        if (refused) {
          resolve({ data: null, error: refused });
          return;
        }
        if (mode === "insert") {
          resolve({ data: storeInserted(), error: null });
          return;
        }
        if (mode === "upsert") {
          const rows = tables[table]!;
          const p = payload as Row;
          const idx = rows.findIndex((r) => upsertConflict.every((k) => r[k] === p[k]));
          if (idx >= 0) rows[idx] = { ...rows[idx], ...p };
          else rows.push({ id: crypto.randomUUID(), ...p });
          resolve({ data: null, error: null });
          return;
        }
        if (mode === "update") {
          for (const r of tables[table]!) {
            if (matches(r, filters)) Object.assign(r, payload as Row);
          }
          resolve({ data: null, error: null });
          return;
        }
        if (mode === "delete") {
          const kept = tables[table]!.filter((r) => !matches(r, filters));
          tables[table] = kept;
          resolve({ data: [], error: null });
          return;
        }
        resolve({ data: computeSelected(), error: null });
      },
    };
    return api;
  }

  return {
    tables,
    missingColumns,
    insertTriggers,
    selects,
    inserts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: { from: (t: string) => builder(t) } as any,
  };
}

const USER = "11111111-1111-1111-1111-111111111111";
const COACH = "22222222-2222-2222-2222-222222222222";
const ATHLETE = "33333333-3333-3333-3333-333333333333";
const ATHLETE_2 = "44444444-4444-4444-4444-444444444444";
const SLOT = "66666666-6666-6666-6666-666666666666";

function seedCoach(db: ReturnType<typeof makeDb>, userId = USER, coachId = COACH) {
  db.tables.coach_profiles.push({ id: coachId, user_id: userId });
}

function seedRoster(
  db: ReturnType<typeof makeDb>,
  athleteId: string,
  { coachId = COACH, first = "Alex", last = "Athlete" } = {},
) {
  db.tables.coach_athletes.push({
    id: crypto.randomUUID(),
    coach_id: coachId,
    athlete_id: athleteId,
  });
  db.tables.athletes.push({ id: athleteId, first_name: first, last_name: last });
}

function ctxFor(db: ReturnType<typeof makeDb>, userId = USER): InvoicingContext {
  return { userId, supabase: db.client };
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

/* -------------------------------------------------------------------------- */
/* setAthleteRate                                                             */
/* -------------------------------------------------------------------------- */

describe("setAthleteRate", () => {
  it("inserts a new rate, then updates it on a second call (upsert onConflict)", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    const ctx = ctxFor(db);

    const first = await setAthleteRate(ctx, ATHLETE, { rateKind: "per_session", rateCents: 4000 });
    expect(first).toEqual({ ok: true });
    expect(db.tables.coach_athlete_rates).toHaveLength(1);
    expect(db.tables.coach_athlete_rates[0]).toMatchObject({
      coach_id: COACH,
      athlete_id: ATHLETE,
      rate_kind: "per_session",
      rate_cents: 4000,
    });

    const second = await setAthleteRate(ctx, ATHLETE, { rateKind: "hourly", rateCents: 6000 });
    expect(second).toEqual({ ok: true });
    // Same (coach_id, athlete_id) row updated in place, not a second row inserted.
    expect(db.tables.coach_athlete_rates).toHaveLength(1);
    expect(db.tables.coach_athlete_rates[0]).toMatchObject({
      rate_kind: "hourly",
      rate_cents: 6000,
    });
  });

  it("rejects an athlete who isn't on the coach's roster", async () => {
    const db = makeDb();
    seedCoach(db);
    // No coach_athletes row for ATHLETE.
    const ctx = ctxFor(db);

    const err = await caught(() =>
      setAthleteRate(ctx, ATHLETE, { rateKind: "per_session", rateCents: 1000 }),
    );
    expect(err?.code).toBe("unprocessable");
    expect(err?.message).toBe("Athlete is not on your roster");
    expect(db.tables.coach_athlete_rates).toHaveLength(0);
  });

  it("answers the database's roster refusal (an athlete removed since the check) the same way", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    const realFrom = db.client.from;
    db.client.from = ((t: string) => {
      if (t !== "coach_athlete_rates") return realFrom(t);
      return {
        ...realFrom(t),
        upsert: () => ({
          then(resolve: (v: { data: null; error: { code: string; message: string } }) => void) {
            resolve({
              data: null,
              error: {
                code: "42501",
                message:
                  'new row violates row-level security policy for table "coach_athlete_rates"',
              },
            });
          },
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    const err = await caught(() =>
      setAthleteRate(ctxFor(db), ATHLETE, { rateKind: "per_session", rateCents: 1000 }),
    );
    expect(err?.code).toBe("unprocessable");
    expect(err?.message).toBe("Athlete is not on your roster");
  });
});

/* -------------------------------------------------------------------------- */
/* getCoachInvoices / getAthleteBilling / getInvoiceDetail                    */
/* -------------------------------------------------------------------------- */

function seedInvoice(
  db: ReturnType<typeof makeDb>,
  opts: {
    id: string;
    athleteId?: string;
    coachId?: string;
    periodStart?: string;
    periodEnd?: string;
    totalCents?: number;
    status?: "unpaid" | "paid";
    createdAt?: string;
    paidAt?: string | null;
    /** Set only when given, so a row can stand for one written before the column existed. */
    currency?: string;
  },
) {
  db.tables.invoices.push({
    id: opts.id,
    coach_id: opts.coachId ?? COACH,
    athlete_id: opts.athleteId ?? ATHLETE,
    period_start: opts.periodStart ?? "2026-01-01",
    period_end: opts.periodEnd ?? "2026-01-31",
    total_cents: opts.totalCents ?? 0,
    status: opts.status ?? "unpaid",
    created_at: opts.createdAt ?? "2026-01-31T00:00:00.000Z",
    paid_at: opts.paidAt ?? null,
    ...(opts.currency ? { currency: opts.currency } : {}),
  });
}

function seedInvoiceLine(
  db: ReturnType<typeof makeDb>,
  opts: { invoiceId: string; occurrenceDate: string; amountCents?: number },
) {
  db.tables.invoice_lines.push({
    id: crypto.randomUUID(),
    invoice_id: opts.invoiceId,
    occurrence_date: opts.occurrenceDate,
    amount_cents: opts.amountCents ?? 0,
    slot_id: null,
    start_minute: null,
    end_minute: null,
    included_reason: "completed",
  });
}

/**
 * Makes `db.client.from(table).insert(...)` fail with the given error,
 * simulating a DB-level rejection (e.g. the 23505 unique-violation a
 * concurrent create can now hit on invoice_lines_unique_athlete_occurrence_idx)
 * that this in-memory fake otherwise has no concurrency to produce for real.
 */
function forceInsertError(
  db: ReturnType<typeof makeDb>,
  table: string,
  error: { code: string; message: string },
) {
  const realFrom = db.client.from;
  db.client.from = ((t: string) => {
    if (t !== table) return realFrom(t);
    return {
      ...realFrom(t),
      insert() {
        return {
          then(resolve: (v: { data: null; error: typeof error }) => void) {
            resolve({ data: null, error });
          },
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

describe("getCoachInvoices", () => {
  it("lists invoices across athletes with their line counts and names", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE, { first: "Alex", last: "One" });
    seedRoster(db, ATHLETE_2, { first: "Bailey", last: "Two" });
    seedInvoice(db, { id: "inv-a", athleteId: ATHLETE, createdAt: "2026-01-01T00:00:00.000Z" });
    seedInvoice(db, { id: "inv-b", athleteId: ATHLETE_2, createdAt: "2026-02-01T00:00:00.000Z" });
    seedInvoiceLine(db, { invoiceId: "inv-a", occurrenceDate: "2026-01-05" });
    seedInvoiceLine(db, { invoiceId: "inv-a", occurrenceDate: "2026-01-12" });
    seedInvoiceLine(db, { invoiceId: "inv-a", occurrenceDate: "2026-01-19" });
    // inv-b has zero lines.

    const result = await getCoachInvoices(ctxFor(db));

    expect(result).toHaveLength(2);
    // Newest created_at first.
    expect(result[0]).toMatchObject({ id: "inv-b", athleteName: "Bailey Two", lineCount: 0 });
    expect(result[1]).toMatchObject({ id: "inv-a", athleteName: "Alex One", lineCount: 3 });
  });
});

describe("getAthleteBilling", () => {
  it("returns the athlete's rate and invoice history together", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE, { first: "Alex", last: "One" });
    db.tables.coach_athlete_rates.push({
      coach_id: COACH,
      athlete_id: ATHLETE,
      rate_kind: "hourly",
      rate_cents: 5500,
    });
    seedInvoice(db, { id: "inv-a", athleteId: ATHLETE });
    seedInvoiceLine(db, { invoiceId: "inv-a", occurrenceDate: "2026-01-05" });

    const result = await getAthleteBilling(ctxFor(db), ATHLETE);

    expect(result.athleteId).toBe(ATHLETE);
    expect(result.athleteName).toBe("Alex One");
    expect(result.rate).toEqual({ rateKind: "hourly", rateCents: 5500 });
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0]).toMatchObject({
      id: "inv-a",
      lineCount: 1,
      athleteName: "Alex One",
    });
  });

  it("returns a null rate for an athlete with no rate set", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);

    const result = await getAthleteBilling(ctxFor(db), ATHLETE);
    expect(result.rate).toBeNull();
    expect(result.invoices).toEqual([]);
  });
});

describe("getInvoiceDetail", () => {
  it("returns the invoice with its lines in occurrence-date order", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE, { first: "Alex", last: "One" });
    seedInvoice(db, { id: "inv-a", athleteId: ATHLETE, totalCents: 9000 });
    seedInvoiceLine(db, { invoiceId: "inv-a", occurrenceDate: "2026-01-19", amountCents: 4000 });
    seedInvoiceLine(db, { invoiceId: "inv-a", occurrenceDate: "2026-01-05", amountCents: 5000 });

    const result = await getInvoiceDetail(ctxFor(db), "inv-a");

    expect(result.id).toBe("inv-a");
    expect(result.athleteName).toBe("Alex One");
    expect(result.lineCount).toBe(2);
    expect(result.lines).toEqual([
      { occurrenceDate: "2026-01-05", amountCents: 5000 },
      { occurrenceDate: "2026-01-19", amountCents: 4000 },
    ]);
  });

  it("throws not_found for a missing or foreign invoice", async () => {
    const db = makeDb();
    seedCoach(db);

    const err = await caught(() => getInvoiceDetail(ctxFor(db), "does-not-exist"));
    expect(err?.code).toBe("not_found");
    expect(err?.message).toBe("Invoice not found");
  });
});

/* -------------------------------------------------------------------------- */
/* previewInvoice / buildPreview date math                                    */
/* -------------------------------------------------------------------------- */

function seedWeeklySlot(
  db: ReturnType<typeof makeDb>,
  opts: {
    id?: string;
    dayOfWeek: number;
    startMinute?: number;
    endMinute?: number;
    startsOn?: string | null;
    athleteId?: string;
  },
) {
  db.tables.athlete_lesson_slots.push({
    id: opts.id ?? SLOT,
    coach_id: COACH,
    athlete_id: opts.athleteId ?? ATHLETE,
    day_of_week: opts.dayOfWeek,
    start_minute: opts.startMinute ?? 600,
    end_minute: opts.endMinute ?? 660,
    frequency: "weekly",
    weeks_of_month: [],
    starts_on: opts.startsOn ?? null,
  });
}

describe("previewInvoice (buildPreview date math)", () => {
  it("excludes an occurrence date that has already been invoiced", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    // Mondays: 2026-01-05, 2026-01-12, 2026-01-19.
    seedWeeklySlot(db, { dayOfWeek: 1 });
    seedInvoice(db, { id: "inv-old", athleteId: ATHLETE, periodEnd: "2026-01-11" });
    seedInvoiceLine(db, { invoiceId: "inv-old", occurrenceDate: "2026-01-12" });

    const result = await previewInvoice(ctxFor(db), {
      athleteId: ATHLETE,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-19",
    });

    const dates = result.lines.map((l) => l.occurrenceDate);
    expect(dates).toEqual(["2026-01-05", "2026-01-19"]);
    expect(dates).not.toContain("2026-01-12");
  });

  it("marks a canceled override as canceled and excludes it by default", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    seedWeeklySlot(db, { dayOfWeek: 1 });
    db.tables.lesson_slot_overrides.push({
      slot_id: SLOT,
      occurrence_date: "2026-01-12",
      status: "canceled",
      start_minute: null,
      end_minute: null,
    });

    const result = await previewInvoice(ctxFor(db), {
      athleteId: ATHLETE,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-19",
    });

    const canceled = result.lines.find((l) => l.occurrenceDate === "2026-01-12");
    expect(canceled?.state).toBe("canceled");
    expect(canceled?.defaultIncluded).toBe(false);
  });

  it("reflects a did_not_happen wrap-up on its line", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    seedWeeklySlot(db, { dayOfWeek: 1 });
    db.tables.lesson_wrap_ups.push({
      coach_id: COACH,
      athlete_id: ATHLETE,
      lesson_date: "2026-01-12",
      action: "did_not_happen",
    });

    const result = await previewInvoice(ctxFor(db), {
      athleteId: ATHLETE,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-19",
    });

    const line = result.lines.find((l) => l.occurrenceDate === "2026-01-12");
    expect(line?.state).toBe("did_not_happen");
    expect(line?.defaultIncluded).toBe(false);
  });

  it("marks a completed wrap-up as confirmed and keeps it included", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    seedWeeklySlot(db, { dayOfWeek: 1 });
    db.tables.lesson_wrap_ups.push({
      coach_id: COACH,
      athlete_id: ATHLETE,
      lesson_date: "2026-01-12",
      action: "logged",
    });

    const result = await previewInvoice(ctxFor(db), {
      athleteId: ATHLETE,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-19",
    });

    const line = result.lines.find((l) => l.occurrenceDate === "2026-01-12");
    expect(line?.state).toBe("confirmed");
    expect(line?.defaultIncluded).toBe(true);
  });

  it("suggests the next period start rolling forward from the last invoice's period_end", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    seedInvoice(db, { id: "inv-old", athleteId: ATHLETE, periodEnd: "2026-01-19" });

    const result = await previewInvoice(ctxFor(db), {
      athleteId: ATHLETE,
      periodStart: null,
      periodEnd: null,
    });

    expect(result.suggestedPeriodStart).toBe("2026-01-20");
    expect(result.periodStart).toBe("2026-01-20");
  });

  it("clamps an unbounded period start to the MAX_WINDOW_DAYS floor", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    // No prior invoice, so nothing else would otherwise bound periodStart.

    const periodEnd = "2026-06-01";
    const expectedFloor = toIsoDate(addDays(parseIsoDate(periodEnd), -400));

    const result = await previewInvoice(ctxFor(db), {
      athleteId: ATHLETE,
      periodStart: "2020-01-01",
      periodEnd,
    });

    expect(result.periodStart).toBe(expectedFloor);
    expect(result.periodStart).not.toBe("2020-01-01");
  });
});

/* -------------------------------------------------------------------------- */
/* createInvoice                                                              */
/* -------------------------------------------------------------------------- */

describe("createInvoice", () => {
  it("re-checks the draft server-side and drops a date that was billed since the preview was drawn", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    seedInvoice(db, { id: "inv-existing", athleteId: ATHLETE });
    // Billed out from under a stale client draft.
    seedInvoiceLine(db, { invoiceId: "inv-existing", occurrenceDate: "2026-02-01" });

    const result = await createInvoice(ctxFor(db), {
      athleteId: ATHLETE,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      lines: [
        {
          occurrenceDate: "2026-02-01",
          amountCents: 5000,
          slotId: null,
          startMinute: null,
          endMinute: null,
          includedReason: "completed",
        },
        {
          occurrenceDate: "2026-02-08",
          amountCents: 5000,
          slotId: null,
          startMinute: null,
          endMinute: null,
          includedReason: "completed",
        },
      ],
    });

    expect(result.lineCount).toBe(1);
    expect(result.totalCents).toBe(5000);

    const newInvoiceLines = db.tables.invoice_lines.filter(
      (l) => l.invoice_id === result.invoiceId,
    );
    expect(newInvoiceLines).toHaveLength(1);
    expect(newInvoiceLines[0]?.occurrence_date).toBe("2026-02-08");
  });

  it("rejects outright when every submitted date has already been invoiced", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    seedInvoice(db, { id: "inv-existing", athleteId: ATHLETE });
    seedInvoiceLine(db, { invoiceId: "inv-existing", occurrenceDate: "2026-02-01" });

    const err = await caught(() =>
      createInvoice(ctxFor(db), {
        athleteId: ATHLETE,
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
        lines: [
          {
            occurrenceDate: "2026-02-01",
            amountCents: 5000,
            slotId: null,
            startMinute: null,
            endMinute: null,
            includedReason: "completed",
          },
        ],
      }),
    );
    expect(err?.code).toBe("unprocessable");
    expect(err?.message).toBe("Those sessions have already been invoiced.");
    // Only the pre-existing invoice remains.
    expect(db.tables.invoices).toHaveLength(1);
  });

  it("rolls back the header and gives the friendly 'already invoiced' error when the DB rejects a concurrent duplicate line", async () => {
    // Simulates two concurrent createInvoice() calls for the same athlete
    // and date: both pass the read-then-filter "already billed" check
    // before either has inserted, so the loser's insert now hits
    // invoice_lines_unique_athlete_occurrence_idx (23505) instead of
    // silently creating a second invoice for the same lesson.
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    forceInsertError(db, "invoice_lines", {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "invoice_lines_unique_athlete_occurrence_idx"',
    });

    const err = await caught(() =>
      createInvoice(ctxFor(db), {
        athleteId: ATHLETE,
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        lines: [
          {
            occurrenceDate: "2026-05-01",
            amountCents: 5000,
            slotId: null,
            startMinute: null,
            endMinute: null,
            includedReason: "completed",
          },
        ],
      }),
    );

    expect(err?.code).toBe("unprocessable");
    expect(err?.message).toBe("Those sessions have already been invoiced.");
    // No orphaned header left behind.
    expect(db.tables.invoices).toHaveLength(0);
  });
});

describe("createInvoice stays on the coach's roster", () => {
  const input = (athleteId: string) => ({
    athleteId,
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    lines: [
      {
        occurrenceDate: "2026-05-01",
        amountCents: 5000,
        slotId: null,
        startMinute: null,
        endMinute: null,
        includedReason: "completed" as const,
      },
    ],
  });

  it("refuses an athlete who isn't on the coach's roster and writes nothing", async () => {
    const db = makeDb();
    seedCoach(db);
    // No coach_athletes row for ATHLETE.
    const err = await caught(() => createInvoice(ctxFor(db), input(ATHLETE)));
    expect(err?.code).toBe("unprocessable");
    expect(err?.message).toBe("Athlete is not on your roster");
    expect(db.tables.invoices).toHaveLength(0);
    expect(db.tables.invoice_lines).toHaveLength(0);
  });

  it("answers the database's roster refusal (an athlete removed since the check) the same way", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    const realFrom = db.client.from;
    db.client.from = ((t: string) => {
      if (t !== "invoices") return realFrom(t);
      return {
        ...realFrom(t),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: "42501",
                message: 'new row violates row-level security policy for table "invoices"',
              },
            }),
          }),
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    const err = await caught(() => createInvoice(ctxFor(db), input(ATHLETE)));
    expect(err?.code).toBe("unprocessable");
    expect(err?.message).toBe("Athlete is not on your roster");
    expect(db.tables.invoice_lines).toHaveLength(0);
  });
});

describe("previewInvoice stays on the coach's roster", () => {
  it("refuses an athlete who isn't on the coach's roster", async () => {
    const db = makeDb();
    seedCoach(db);
    const err = await caught(() =>
      previewInvoice(ctxFor(db), {
        athleteId: ATHLETE,
        periodStart: "2026-01-05",
        periodEnd: "2026-01-19",
      }),
    );
    expect(err?.code).toBe("unprocessable");
    expect(err?.message).toBe("Athlete is not on your roster");
  });
});

/* -------------------------------------------------------------------------- */
/* setInvoiceStatus / deleteInvoice                                           */
/* -------------------------------------------------------------------------- */

describe("setInvoiceStatus", () => {
  it("stamps paid_at when moving to paid and clears it moving back to unpaid", async () => {
    const db = makeDb();
    seedCoach(db);
    seedInvoice(db, { id: "inv-a", status: "unpaid", paidAt: null });
    const ctx = ctxFor(db);

    await setInvoiceStatus(ctx, "inv-a", { status: "paid" });
    let row = db.tables.invoices.find((r) => r.id === "inv-a")!;
    expect(row.status).toBe("paid");
    expect(typeof row.paid_at).toBe("string");
    expect(Number.isNaN(Date.parse(row.paid_at as string))).toBe(false);

    await setInvoiceStatus(ctx, "inv-a", { status: "unpaid" });
    row = db.tables.invoices.find((r) => r.id === "inv-a")!;
    expect(row.status).toBe("unpaid");
    expect(row.paid_at).toBeNull();
  });

  it("needs no roster row: a late payment for an athlete who has left can still be recorded", async () => {
    // The invoices policy lets a coach keep updating an invoice whose athlete is no longer on
    // their roster (it only refuses re-pointing one), so the API does not check the roster here.
    const db = makeDb();
    seedCoach(db);
    // No coach_athletes row for ATHLETE.
    seedInvoice(db, { id: "inv-left", athleteId: ATHLETE, status: "unpaid", paidAt: null });

    await setInvoiceStatus(ctxFor(db), "inv-left", { status: "paid" });
    expect(db.tables.invoices.find((r) => r.id === "inv-left")!.status).toBe("paid");
  });

  it("404s instead of silently no-op'ing when the invoice doesn't exist (or belongs to another coach)", async () => {
    const db = makeDb();
    seedCoach(db);
    seedInvoice(db, { id: "inv-a", status: "unpaid", paidAt: null, coachId: "some-other-coach" });

    const err = await caught(() => setInvoiceStatus(ctxFor(db), "inv-a", { status: "paid" }));
    expect(err?.code).toBe("not_found");
    expect(err?.message).toBe("Invoice not found");
    // Untouched — it belongs to a different coach.
    const row = db.tables.invoices.find((r) => r.id === "inv-a")!;
    expect(row.status).toBe("unpaid");

    const missing = await caught(() =>
      setInvoiceStatus(ctxFor(db), "does-not-exist", { status: "paid" }),
    );
    expect(missing?.code).toBe("not_found");
  });
});

describe("deleteInvoice", () => {
  it("refuses to delete a paid invoice", async () => {
    const db = makeDb();
    seedCoach(db);
    seedInvoice(db, { id: "inv-a", status: "paid" });

    const err = await caught(() => deleteInvoice(ctxFor(db), "inv-a"));
    expect(err?.code).toBe("unprocessable");
    expect(err?.message).toBe("Paid invoices can't be deleted.");
    expect(db.tables.invoices).toHaveLength(1);
  });

  it("deletes an unpaid invoice", async () => {
    const db = makeDb();
    seedCoach(db);
    seedInvoice(db, { id: "inv-a", status: "unpaid" });

    const result = await deleteInvoice(ctxFor(db), "inv-a");
    expect(result).toEqual({ ok: true });
    expect(db.tables.invoices).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

describe("encodeInvoiceCursor / decodeInvoiceCursor", () => {
  it("round-trips", () => {
    const cursor = encodeInvoiceCursor("2026-01-05T00:00:00.000Z", "inv-3");
    expect(decodeInvoiceCursor(cursor)).toEqual({
      createdAt: "2026-01-05T00:00:00.000Z",
      id: "inv-3",
    });
  });

  it("rejects a malformed cursor", () => {
    expect(() => decodeInvoiceCursor("not-a-real-cursor")).toThrow(ApiError);
  });
});

describe("getCoachInvoicesPage", () => {
  it("pages through results newest-first and terminates with a null cursor", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    for (let i = 1; i <= 5; i += 1) {
      seedInvoice(db, {
        id: `inv-${i}`,
        athleteId: ATHLETE,
        createdAt: `2026-01-0${i}T00:00:00.000Z`,
      });
    }
    const ctx = ctxFor(db);

    const page1 = await getCoachInvoicesPage(ctx, { limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual(["inv-5", "inv-4"]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await getCoachInvoicesPage(ctx, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((i) => i.id)).toEqual(["inv-3", "inv-2"]);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await getCoachInvoicesPage(ctx, { limit: 2, cursor: page2.nextCursor! });
    expect(page3.items.map((i) => i.id)).toEqual(["inv-1"]);
    expect(page3.nextCursor).toBeNull();
  });

  it("returns an empty page with a null cursor when the coach has no invoices", async () => {
    const db = makeDb();
    seedCoach(db);

    const result = await getCoachInvoicesPage(ctxFor(db), { limit: 50 });
    expect(result).toEqual({ items: [], nextCursor: null });
  });
});

/* -------------------------------------------------------------------------- */
/* POST /api/v1/coach/invoices idempotency (route-level wiring)               */
/* -------------------------------------------------------------------------- */

/**
 * Minimal fake `.rpc()` simulating the three `*_idempotency_key` Postgres
 * functions idempotency.ts calls — the same shape
 * `src/lib/api/define-route.test.ts` uses for this. See
 * supabase/migrations/20260908030000_idempotency_key_reservation.sql for
 * the real functions this mirrors.
 */
function createFakeAdmin() {
  const store = new Map<string, Record<string, unknown>>();
  return {
    async rpc(fn: string, params: Record<string, unknown>) {
      const rowKey = `${params._user_id}::${params._key}`;
      if (fn === "reserve_idempotency_key") {
        const now = Date.now();
        const existing = store.get(rowKey);
        if (!existing) {
          store.set(rowKey, {
            request_hash: params._request_hash,
            response_status: null,
            response_body: null,
            created_at: new Date(now).toISOString(),
          });
          return {
            data: [{ state: "reserved", response_status: null, response_body: null }],
            error: null,
          };
        }
        const ageSeconds = (now - new Date(existing.created_at as string).getTime()) / 1000;
        const expired =
          existing.response_status != null
            ? ageSeconds > (params._replay_window_seconds as number)
            : ageSeconds > (params._pending_timeout_seconds as number);
        if (expired) {
          Object.assign(existing, {
            request_hash: params._request_hash,
            response_status: null,
            response_body: null,
            created_at: new Date(now).toISOString(),
          });
          return {
            data: [{ state: "reserved", response_status: null, response_body: null }],
            error: null,
          };
        }
        if (existing.response_status == null) {
          return {
            data: [{ state: "in_progress", response_status: null, response_body: null }],
            error: null,
          };
        }
        if (existing.request_hash !== params._request_hash) {
          return {
            data: [{ state: "key_reused", response_status: null, response_body: null }],
            error: null,
          };
        }
        return {
          data: [
            {
              state: "replay",
              response_status: existing.response_status,
              response_body: existing.response_body,
            },
          ],
          error: null,
        };
      }
      if (fn === "complete_idempotency_key") {
        const row = store.get(rowKey);
        if (row) {
          row.response_status = params._response_status;
          row.response_body = params._response_body;
        }
        return { data: null, error: null };
      }
      if (fn === "release_idempotency_key") {
        const row = store.get(rowKey);
        if (row && row.response_status == null) store.delete(rowKey);
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unknown rpc: ${fn}` } };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as ApiContext["admin"];
}

describe("POST /api/v1/coach/invoices idempotency", () => {
  it("replays the stored response instead of inserting the invoice twice", async () => {
    process.env.API_V1_ENABLED = "true";
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    const admin = createFakeAdmin();
    let calls = 0;
    const apiCtx: ApiContext = { userId: USER, supabase: db.client, admin };

    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/coach/invoices",
        auth: "user",
        idempotent: true,
        input: createInvoiceInput,
        output: createInvoiceResultSchema,
        handler: async ({ ctx, input }) => {
          calls += 1;
          const { userId, supabase } = requireContext(ctx);
          return createInvoice({ userId, supabase }, input);
        },
      },
      { admin, authenticate: async () => apiCtx },
    );

    const body = JSON.stringify({
      athleteId: ATHLETE,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      lines: [{ occurrenceDate: "2026-03-05", amountCents: 5000 }],
    });
    const req = () =>
      new Request("https://gradus.training/api/v1/coach/invoices", {
        method: "POST",
        body,
        headers: {
          authorization: "Bearer t",
          "idempotency-key": "retry-key-1",
          "content-type": "application/json",
        },
      });

    const first = await POST!({ request: req() });
    const second = await POST!({ request: req() });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(calls).toBe(1);
    expect(db.tables.invoices).toHaveLength(1);
    expect(db.tables.invoice_lines).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Group lessons, lesson prices and billed cancellations (decision #68)       */
/* -------------------------------------------------------------------------- */

describe("previewInvoice with group lessons (decision #68)", () => {
  const window = { athleteId: ATHLETE, periodStart: "2026-01-05", periodEnd: "2026-01-19" };

  it("bills a lesson's own price in place of the athlete's rate, and flags a group lesson", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    db.tables.coach_athlete_rates.push({
      coach_id: COACH,
      athlete_id: ATHLETE,
      rate_kind: "hourly",
      rate_cents: 7000,
    });
    seedWeeklySlot(db, { dayOfWeek: 1 }); // private, Mondays, 60 min
    seedWeeklySlot(db, { id: "slot-group", dayOfWeek: 3, startMinute: 1020, endMinute: 1080 });
    Object.assign(db.tables.athlete_lesson_slots[1]!, { group_id: "group-1", price_cents: 3000 });
    seedGroupPartner(db);

    const result = await previewInvoice(ctxFor(db), window);

    const priv = result.lines.find((l) => l.occurrenceDate === "2026-01-05");
    const group = result.lines.find((l) => l.occurrenceDate === "2026-01-07");
    expect(priv?.amountCents).toBe(7000);
    expect(priv && "group" in priv).toBe(false);
    expect(group?.amountCents).toBe(3000);
    expect(group?.group).toBe(true);
  });

  it("uses the lesson's price even when the athlete has no rate", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    seedWeeklySlot(db, { dayOfWeek: 1 });
    Object.assign(db.tables.athlete_lesson_slots[0]!, { group_id: "group-1", price_cents: 2500 });

    const result = await previewInvoice(ctxFor(db), window);

    expect(result.rate).toBeNull();
    expect(result.lines.every((l) => l.amountCents === 2500)).toBe(true);
  });

  it("puts a canceled lesson the coach chose to bill on the draft by default", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    seedWeeklySlot(db, { dayOfWeek: 1 });
    db.tables.lesson_slot_overrides.push(
      { slot_id: SLOT, occurrence_date: "2026-01-12", status: "canceled", billable: true },
      { slot_id: SLOT, occurrence_date: "2026-01-19", status: "canceled", billable: false },
    );

    const result = await previewInvoice(ctxFor(db), window);

    const billed = result.lines.find((l) => l.occurrenceDate === "2026-01-12");
    const dropped = result.lines.find((l) => l.occurrenceDate === "2026-01-19");
    // Still "canceled": a build that predates `billable` decodes the same states.
    expect(billed?.state).toBe("canceled");
    expect(billed?.billable).toBe(true);
    expect(billed?.defaultIncluded).toBe(true);
    expect(dropped?.state).toBe("canceled");
    expect(dropped?.defaultIncluded).toBe(false);
    expect(dropped && "billable" in dropped).toBe(false);
  });

  it("ignores `billable` on a rescheduled date", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    seedWeeklySlot(db, { dayOfWeek: 1 });
    db.tables.lesson_slot_overrides.push({
      slot_id: SLOT,
      occurrence_date: "2026-01-12",
      status: "rescheduled",
      start_minute: 700,
      end_minute: 760,
      billable: true,
    });

    const result = await previewInvoice(ctxFor(db), window);

    const line = result.lines.find((l) => l.occurrenceDate === "2026-01-12");
    expect(line?.state).toBe("scheduled");
    expect(line && "billable" in line).toBe(false);
  });
});

const GROUP_SLOT = "5107aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LATE_SLOT = "5107bbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Another athlete's slot in "group-1", so the group has two members. */
function seedGroupPartner(db: ReturnType<typeof makeDb>) {
  seedWeeklySlot(db, {
    id: "slot-group-partner",
    athleteId: "athlete-partner",
    dayOfWeek: 3,
    startMinute: 1020,
    endMinute: 1080,
  });
  Object.assign(db.tables.athlete_lesson_slots.at(-1)!, { group_id: "group-1", price_cents: 3000 });
}

function seedPrivateAndGroup(db: ReturnType<typeof makeDb>) {
  seedCoach(db);
  seedRoster(db, ATHLETE);
  seedWeeklySlot(db, { dayOfWeek: 1 }); // private, Mondays
  seedWeeklySlot(db, { id: GROUP_SLOT, dayOfWeek: 3, startMinute: 1020, endMinute: 1080 });
  Object.assign(db.tables.athlete_lesson_slots[1]!, { group_id: "group-1", price_cents: 3000 });
  seedGroupPartner(db);
}

describe("createInvoice / getInvoiceDetail with group lessons (decision #68)", () => {
  it("reads the group flag and the billed cancellation from the schedule, whatever the client sends", async () => {
    const db = makeDb();
    seedPrivateAndGroup(db);
    db.tables.lesson_slot_overrides.push({
      slot_id: GROUP_SLOT,
      occurrence_date: "2026-01-14",
      status: "canceled",
      start_minute: null,
      end_minute: null,
      billable: true,
    });

    // What a build that predates decision #68 sends: no group flag, and
    // "completed" for every ticked line.
    const created = await createInvoice(
      ctxFor(db),
      createInvoiceInput.parse({
        athleteId: ATHLETE,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        lines: [
          { slotId: SLOT, occurrenceDate: "2026-01-05", amountCents: 7000 },
          { slotId: GROUP_SLOT, occurrenceDate: "2026-01-07", amountCents: 3000 },
          { slotId: GROUP_SLOT, occurrenceDate: "2026-01-14", amountCents: 3000 },
        ],
      }),
    );
    expect(created.totalCents).toBe(13000);

    // Every row names `is_group`: PostgREST writes NULL for a key missing
    // from some rows of a bulk insert, and the column is NOT NULL.
    expect(db.tables.invoice_lines.map((l) => l.is_group)).toEqual([false, true, true]);

    const detail = await getInvoiceDetail(ctxFor(db), created.invoiceId);
    expect(detail.lines).toEqual([
      { occurrenceDate: "2026-01-05", amountCents: 7000 },
      { occurrenceDate: "2026-01-07", amountCents: 3000, group: true },
      { occurrenceDate: "2026-01-14", amountCents: 3000, group: true, canceledBilled: true },
    ]);
  });

  it("a lone slot left in a group is billed as a private lesson", async () => {
    const db = makeDb();
    seedPrivateAndGroup(db);
    db.tables.athlete_lesson_slots.pop(); // the partner left

    const preview = await previewInvoice(ctxFor(db), {
      athleteId: ATHLETE,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
    });
    expect(preview.lines).toHaveLength(2);
    expect(preview.lines.some((l) => "group" in l)).toBe(false);

    await createInvoice(
      ctxFor(db),
      createInvoiceInput.parse({
        athleteId: ATHLETE,
        periodStart: "2026-01-05",
        periodEnd: "2026-01-11",
        lines: [{ slotId: GROUP_SLOT, occurrenceDate: "2026-01-07", amountCents: 3000 }],
      }),
    );
    expect(db.tables.invoice_lines.map((l) => l.is_group)).toEqual([false]);
  });

  it("a slot id that isn't this athlete's lesson can't get a billed date billed again", async () => {
    const db = makeDb();
    seedPrivateAndGroup(db);
    const window = { athleteId: ATHLETE, periodStart: "2026-01-05", periodEnd: "2026-01-05" };
    const bill = (slotId: string | null) =>
      caught(() =>
        createInvoice(
          ctxFor(db),
          createInvoiceInput.parse({
            ...window,
            lines: [{ slotId, occurrenceDate: "2026-01-05", amountCents: 7000 }],
          }),
        ),
      );

    expect(await bill(SLOT)).toBeNull();
    // Another athlete's slot, and a manual line, on the date already billed.
    expect((await bill("5107cccc-cccc-4ccc-8ccc-cccccccccccc"))?.status).toBe(422);
    expect((await bill(null))?.status).toBe(422);
    expect(db.tables.invoice_lines).toHaveLength(1);
  });

  it("bills two lessons on one date separately", async () => {
    const db = makeDb();
    seedCoach(db);
    seedRoster(db, ATHLETE);
    seedWeeklySlot(db, { dayOfWeek: 1 });
    seedWeeklySlot(db, { id: LATE_SLOT, dayOfWeek: 1, startMinute: 1020, endMinute: 1080 });
    const window = { athleteId: ATHLETE, periodStart: "2026-01-05", periodEnd: "2026-01-05" };

    await createInvoice(
      ctxFor(db),
      createInvoiceInput.parse({
        ...window,
        lines: [{ slotId: SLOT, occurrenceDate: "2026-01-05", amountCents: 7000 }],
      }),
    );

    // The lesson left off the first invoice is still there to bill...
    const preview = await previewInvoice(ctxFor(db), window);
    expect(preview.lines.map((l) => l.slotId)).toEqual([LATE_SLOT]);

    // ...and the one already billed is not billed twice.
    const again = await createInvoice(
      ctxFor(db),
      createInvoiceInput.parse({
        ...window,
        lines: [
          { slotId: SLOT, occurrenceDate: "2026-01-05", amountCents: 7000 },
          { slotId: LATE_SLOT, occurrenceDate: "2026-01-05", amountCents: 3000 },
        ],
      }),
    );
    expect(again).toMatchObject({ totalCents: 3000, lineCount: 1 });
  });
});

/* -------------------------------------------------------------------------- */
/* Invoice currency (decision #69)                                            */
/* -------------------------------------------------------------------------- */

const INVOICE_HEADER = "id, athlete_id, period_start, period_end, total_cents, status, created_at";

function seedTwoInvoices(db: ReturnType<typeof makeDb>, currencies: [string?, string?] = []) {
  seedCoach(db);
  seedRoster(db, ATHLETE, { first: "Alex", last: "One" });
  seedInvoice(db, {
    id: "inv-old",
    createdAt: "2026-01-31T00:00:00.000Z",
    currency: currencies[0],
  });
  seedInvoice(db, {
    id: "inv-new",
    createdAt: "2026-02-28T00:00:00.000Z",
    currency: currencies[1],
  });
  seedInvoiceLine(db, { invoiceId: "inv-new", occurrenceDate: "2026-02-02", amountCents: 7000 });
}

describe("invoice currency on the invoice reads (decision #69)", () => {
  it("carries each invoice's own currency on the list, the page, an athlete's billing and the detail", async () => {
    const db = makeDb();
    seedTwoInvoices(db, ["USD", "GBP"]);
    const ctx = ctxFor(db);

    const list = await getCoachInvoices(ctx);
    expect(list.map((i) => [i.id, i.currency])).toEqual([
      ["inv-new", "GBP"],
      ["inv-old", "USD"],
    ]);

    const page = await getCoachInvoicesPage(ctx, { limit: 50 });
    expect(page.items.map((i) => i.currency)).toEqual(["GBP", "USD"]);

    const billing = await getAthleteBilling(ctx, ATHLETE);
    expect(billing.invoices.map((i) => i.currency)).toEqual(["GBP", "USD"]);

    const detail = await getInvoiceDetail(ctx, "inv-new");
    expect(detail.currency).toBe("GBP");
    expect(detail.lines).toEqual([{ occurrenceDate: "2026-02-02", amountCents: 7000 }]);

    // The value is read from the row: every header select asked for the column.
    expect(db.selects.filter((s) => s.table === "invoices").map((s) => s.columns)).toEqual([
      `${INVOICE_HEADER}, currency`,
      `${INVOICE_HEADER}, currency`,
      `${INVOICE_HEADER}, currency`,
      `${INVOICE_HEADER}, currency`,
    ]);
  });

  it("the response schemas keep the field (a route parses its output through them)", async () => {
    const db = makeDb();
    seedTwoInvoices(db, ["USD", "GBP"]);
    const ctx = ctxFor(db);

    const page = invoicePageSchema.parse(await getCoachInvoicesPage(ctx, { limit: 50 }));
    expect(page.items.map((i) => i.currency)).toEqual(["GBP", "USD"]);
    const billing = athleteBillingSchema.parse(await getAthleteBilling(ctx, ATHLETE));
    expect(billing.invoices.map((i) => i.currency)).toEqual(["GBP", "USD"]);
    const detail = invoiceDetailSchema.parse(await getInvoiceDetail(ctx, "inv-new"));
    expect(detail.currency).toBe("GBP");
  });

  it("still lists, pages and opens invoices, without the field, while the column is missing", async () => {
    const db = makeDb();
    seedTwoInvoices(db);
    db.missingColumns.invoices = ["currency"];
    const ctx = ctxFor(db);

    const list = await getCoachInvoices(ctx);
    expect(list.map((i) => i.id)).toEqual(["inv-new", "inv-old"]);
    expect(list.some((i) => "currency" in i)).toBe(false);

    const page = await getCoachInvoicesPage(ctx, { limit: 1 });
    expect(page.items.map((i) => i.id)).toEqual(["inv-new"]);
    expect(page.nextCursor).toBe(encodeInvoiceCursor("2026-02-28T00:00:00.000Z", "inv-new"));
    expect("currency" in page.items[0]!).toBe(false);
    const next = await getCoachInvoicesPage(ctx, { limit: 1, cursor: page.nextCursor! });
    expect(next.items.map((i) => i.id)).toEqual(["inv-old"]);

    const billing = await getAthleteBilling(ctx, ATHLETE);
    expect(billing.invoices).toHaveLength(2);
    expect(billing.invoices.some((i) => "currency" in i)).toBe(false);

    const detail = await getInvoiceDetail(ctx, "inv-new");
    expect(detail).toMatchObject({ id: "inv-new", lineCount: 1, athleteName: "Alex One" });
    expect("currency" in detail).toBe(false);

    // Each read asked for the column once, then fell back to the old columns.
    const headerSelects = db.selects.filter((s) => s.table === "invoices").map((s) => s.columns);
    expect(headerSelects).toHaveLength(10);
    expect(headerSelects.filter((c) => c === INVOICE_HEADER)).toHaveLength(5);
    expect(headerSelects.filter((c) => c === `${INVOICE_HEADER}, currency`)).toHaveLength(5);
  });

  it("a different database error on an invoice read is not retried or hidden", async () => {
    const db = makeDb();
    seedTwoInvoices(db, ["USD", "GBP"]);
    const realFrom = db.client.from;
    let invoiceReads = 0;
    db.client.from = ((t: string) => {
      if (t !== "invoices") return realFrom(t);
      const real = realFrom(t);
      const failing = {
        select() {
          invoiceReads += 1;
          return failing;
        },
        eq: () => failing,
        order: () => failing,
        limit: () => failing,
        then(resolve: (v: { data: null; error: { code: string; message: string } }) => void) {
          resolve({ data: null, error: { code: "57014", message: "statement timeout" } });
        },
      };
      return { ...real, select: failing.select };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    const realError = console.error;
    console.error = () => {};
    try {
      const err = await getCoachInvoices(ctxFor(db)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("Something went wrong. Please try again.");
    } finally {
      console.error = realError;
    }
    expect(invoiceReads).toBe(1);
  });
});

describe("createInvoice and the invoice currency (decision #69)", () => {
  const input = {
    athleteId: ATHLETE,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    lines: [{ slotId: SLOT, occurrenceDate: "2026-01-05", amountCents: 7000 }],
  };

  function seedBillable(db: ReturnType<typeof makeDb>) {
    seedCoach(db);
    seedRoster(db, ATHLETE);
    seedWeeklySlot(db, { dayOfWeek: 1 });
  }

  it("never names the column on insert, whatever the client sends: the database sets it", async () => {
    const db = makeDb();
    seedBillable(db);

    const created = await createInvoice(
      ctxFor(db),
      // A client that tries to pick the currency itself.
      createInvoiceInput.parse({ ...input, currency: "GBP" }),
    );

    expect(created).toEqual({ invoiceId: created.invoiceId, totalCents: 7000, lineCount: 1 });
    const header = db.inserts.filter((i) => i.table === "invoices");
    expect(header).toHaveLength(1);
    expect(Object.keys(header[0]!.rows[0]!).sort()).toEqual([
      "athlete_id",
      "coach_id",
      "id",
      "period_end",
      "period_start",
      "status",
      "total_cents",
    ]);
  });

  /** The invoices_set_currency trigger for a coach whose invoice currency is `code`. */
  const stampWith = (code: string) => (row: Record<string, unknown>) => ({
    ...row,
    currency: code,
  });

  it("answers with the currency the database stamped, not one the client sent", async () => {
    const db = makeDb();
    seedBillable(db);
    db.insertTriggers.invoices = stampWith("GBP");

    const created = await createInvoice(
      ctxFor(db),
      createInvoiceInput.parse({ ...input, currency: "CAD" }),
    );

    expect(created).toEqual({
      invoiceId: created.invoiceId,
      totalCents: 7000,
      lineCount: 1,
      currency: "GBP",
    });
    // It travels through the route's output schema to the apps.
    expect(createInvoiceResultSchema.parse(created).currency).toBe("GBP");
    // And it is the value the invoice reads carry afterwards.
    expect((await getInvoiceDetail(ctxFor(db), created.invoiceId)).currency).toBe("GBP");
    // One header, written once: reading the stamp back is part of the insert.
    expect(db.inserts.filter((i) => i.table === "invoices")).toHaveLength(1);
    expect(db.selects.filter((q) => q.table === "invoices" && q.columns === "currency")).toEqual(
      [],
    );
  });

  it("passes through a stamped code this build does not know", async () => {
    const db = makeDb();
    seedBillable(db);
    db.insertTriggers.invoices = stampWith("CHF");

    const created = await createInvoice(ctxFor(db), createInvoiceInput.parse(input));

    expect(createInvoiceResultSchema.parse(created).currency).toBe("CHF");
  });

  it("leaves the field out when the database stamped nothing", async () => {
    const db = makeDb();
    seedBillable(db);

    const created = await createInvoice(ctxFor(db), createInvoiceInput.parse(input));

    expect("currency" in created).toBe(false);
    expect("currency" in createInvoiceResultSchema.parse(created)).toBe(false);
  });

  it("creates an invoice before the migration, when the column does not exist", async () => {
    const db = makeDb();
    seedBillable(db);
    db.missingColumns.invoices = ["currency"];

    const created = await createInvoice(ctxFor(db), createInvoiceInput.parse(input));

    expect(created).toMatchObject({ totalCents: 7000, lineCount: 1 });
    expect("currency" in created).toBe(false);
    // The refused first attempt wrote nothing: one header and its one line.
    expect(db.tables.invoices).toHaveLength(1);
    expect(db.inserts.filter((i) => i.table === "invoices")).toHaveLength(1);
    expect(db.tables.invoice_lines).toHaveLength(1);
    const detail = await getInvoiceDetail(ctxFor(db), created.invoiceId);
    expect(detail.totalCents).toBe(7000);
    expect("currency" in detail).toBe(false);
  });
});
