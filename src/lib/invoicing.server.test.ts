import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { requireContext, type ApiContext } from "./api/auth";
import { createApiRouteHandler } from "./api/define-route";
import { createInvoiceResultSchema } from "./api/invoicing-schema";
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

    function project(row: Row): Row {
      const out: Row = { ...row };
      if (!selectCols) return out;
      for (const part of selectCols.split(",").map((s) => s.trim())) {
        const m = part.match(/^(\w+)\((.+)\)$/);
        if (m) {
          const [, relTable, relColsStr] = m;
          const relCols = relColsStr!.split(",").map((s) => s.trim());
          const relRows = tables[relTable!]!.filter((r) => r.invoice_id === row.id);
          out[relTable!] = relRows.map((r) => {
            const proj: Row = {};
            for (const c of relCols) proj[c] = r[c];
            return proj;
          });
        }
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

    const api = {
      select(cols: string) {
        selectCols = cols;
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
        if (mode === "insert") {
          const rows = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({
            id: (r as Row).id ?? crypto.randomUUID(),
            ...(r as Row),
          }));
          tables[table]!.push(...rows);
          return { data: rows[0] ?? null, error: null };
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
        return res.data ? res : { data: null, error: { message: "no rows" } };
      },
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        if (mode === "insert") {
          const rows = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({
            id: (r as Row).id ?? crypto.randomUUID(),
            ...(r as Row),
          }));
          tables[table]!.push(...rows);
          resolve({ data: rows, error: null });
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
