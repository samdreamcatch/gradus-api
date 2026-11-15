/**
 * Coach invoicing (PRD §7.11 "Billing and invoicing"): per-athlete rates,
 * draft-preview generation from lesson occurrences, invoice create/detail/
 * list/status/delete. Single source of truth for invoicing.functions.ts and
 * the `/api/v1/coach/athletes/{id}/rate`, `/api/v1/coach/athletes/{id}/billing`,
 * and `/api/v1/coach/invoices*` routes. Extracted without behavior changes;
 * the web wrapper turns `ApiError`s back into their original plain messages
 * via `rethrowPlain`.
 *
 * Coach-only, matching the PRD: there is no parent- or athlete-facing
 * invoicing API. A coach hands an invoice to a parent via the native share
 * sheet (`share-invoice.ts`), not an in-app parent view.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { liveGroupIds } from "./lesson-group-guard.server";
import {
  addDays,
  expandSlotOccurrences,
  parseIsoDate,
  toIsoDate,
  type LessonFrequency,
} from "./lesson-recurrence";

type Client = SupabaseClient<Database>;

export type InvoicingContext = { userId: string; supabase: Client };

export type RateKind = "per_session" | "hourly";
export type InvoiceStatus = "unpaid" | "paid";

/** Why a draft line is on the review screen — drives its default checked state. */
export type DraftLineState = "confirmed" | "scheduled" | "did_not_happen" | "canceled";

export interface AthleteRateDTO {
  rateKind: RateKind;
  rateCents: number;
}

export interface DraftLineDTO {
  slotId: string;
  occurrenceDate: string;
  startMinute: number;
  endMinute: number;
  amountCents: number;
  state: DraftLineState;
  /** Pre-checked on the review screen. */
  defaultIncluded: boolean;
  /** A group lesson (decision #68). Absent on a private lesson. */
  group?: boolean;
  /**
   * On a `canceled` line: the coach chose to bill it anyway, so it is
   * pre-checked. A field rather than a new `state`, so a build that predates
   * it still decodes the draft.
   */
  billable?: boolean;
}

export interface InvoicePreviewDTO {
  athleteId: string;
  athleteName: string;
  rate: AthleteRateDTO | null;
  /** Null when the coach has never invoiced this athlete — they pick a start. */
  suggestedPeriodStart: string | null;
  periodStart: string;
  periodEnd: string;
  lines: DraftLineDTO[];
}

export interface InvoiceLineDTO {
  occurrenceDate: string;
  amountCents: number;
  /** A group lesson (decision #68). Absent on a private lesson. */
  group?: boolean;
  /** A canceled lesson the coach billed anyway. Absent otherwise. */
  canceledBilled?: boolean;
}

export interface InvoiceDTO {
  id: string;
  athleteId: string;
  athleteName: string;
  periodStart: string;
  periodEnd: string;
  totalCents: number;
  status: InvoiceStatus;
  createdAt: string;
  lineCount: number;
}

export interface AthleteBillingDTO {
  athleteId: string;
  athleteName: string;
  rate: AthleteRateDTO | null;
  invoices: InvoiceDTO[];
}

const MAX_WINDOW_DAYS = 400;

type Rows<T> = { data: T[] | null; error: { code?: string; message: string } | null };

/** Postgres "undefined column", or PostgREST's schema-cache miss for one. */
const isMissingColumn = (error: { code?: string } | null | undefined) =>
  error?.code === "42703" || error?.code === "PGRST204";

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });
const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });

async function requireCoach(supabase: Client, userId: string): Promise<{ coachId: string }> {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw unprocessable("Coach profile not found");
  return { coachId: data.id };
}

async function assertRostered(supabase: Client, coachId: string, athleteId: string) {
  const { data, error } = await supabase
    .from("coach_athletes")
    .select("id")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw unprocessable("Athlete is not on your roster");
}

async function athleteNameById(supabase: Client, athleteIds: string[]) {
  const map = new Map<string, string>();
  if (athleteIds.length === 0) return map;
  const { data, error } = await supabase
    .from("athletes")
    .select("id, first_name, last_name")
    .in("id", athleteIds);
  if (error) dbError(error);
  for (const a of data ?? []) {
    map.set(a.id, `${a.first_name} ${a.last_name}`.trim());
  }
  return map;
}

function amountForSlot(rate: AthleteRateDTO, startMinute: number, endMinute: number): number {
  if (rate.rateKind === "per_session") return rate.rateCents;
  const minutes = Math.max(0, endMinute - startMinute);
  return Math.round((rate.rateCents * minutes) / 60);
}

// --- Rate -------------------------------------------------------------------

/** `PUT /api/v1/coach/athletes/{id}/rate` body (the athlete id is in the path). */
export const setAthleteRateBody = z.object({
  rateKind: z.enum(["per_session", "hourly"]),
  rateCents: z.number().int().min(0).max(10_000_000),
});

export async function setAthleteRate(
  ctx: InvoicingContext,
  athleteId: string,
  data: z.infer<typeof setAthleteRateBody>,
): Promise<{ ok: true }> {
  const { supabase, userId } = ctx;
  const { coachId } = await requireCoach(supabase, userId);
  await assertRostered(supabase, coachId, athleteId);

  const { error } = await supabase.from("coach_athlete_rates").upsert(
    {
      coach_id: coachId,
      athlete_id: athleteId,
      rate_kind: data.rateKind,
      rate_cents: data.rateCents,
    },
    { onConflict: "coach_id,athlete_id" },
  );
  // The write is scoped to the caller's own coach_id, so the roster clause of
  // "Coaches manage own athlete rates" is the only one that can fail with 42501
  // (an athlete removed from the roster since the check above).
  if (error?.code === "42501") throw unprocessable("Athlete is not on your roster");
  if (error) dbError(error);
  return { ok: true as const };
}

// --- Reads ------------------------------------------------------------------

type InvoiceRow = {
  id: string;
  athlete_id: string;
  period_start: string;
  period_end: string;
  total_cents: number;
  status: string;
  created_at: string;
};

/** Line counts + athlete names for a page of invoice header rows, as `InvoiceDTO`s. */
async function hydrateInvoiceRows(supabase: Client, rows: InvoiceRow[]): Promise<InvoiceDTO[]> {
  if (rows.length === 0) return [];

  const [{ data: lineRows, error: lErr }, names] = await Promise.all([
    supabase
      .from("invoice_lines")
      .select("invoice_id")
      .in(
        "invoice_id",
        rows.map((r) => r.id),
      ),
    athleteNameById(supabase, Array.from(new Set(rows.map((r) => r.athlete_id)))),
  ]);
  if (lErr) dbError(lErr);

  const lineCounts = new Map<string, number>();
  for (const l of lineRows ?? []) {
    lineCounts.set(l.invoice_id, (lineCounts.get(l.invoice_id) ?? 0) + 1);
  }

  return rows.map((r) => ({
    id: r.id,
    athleteId: r.athlete_id,
    athleteName: names.get(r.athlete_id) ?? "Athlete",
    periodStart: r.period_start,
    periodEnd: r.period_end,
    totalCents: r.total_cents,
    status: r.status as InvoiceStatus,
    createdAt: r.created_at,
    lineCount: lineCounts.get(r.id) ?? 0,
  }));
}

async function loadInvoices(
  supabase: Client,
  coachId: string,
  athleteId?: string,
): Promise<InvoiceDTO[]> {
  let query = supabase
    .from("invoices")
    .select("id, athlete_id, period_start, period_end, total_cents, status, created_at")
    .eq("coach_id", coachId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (athleteId) query = query.eq("athlete_id", athleteId);

  const { data, error } = await query;
  if (error) dbError(error);
  return hydrateInvoiceRows(supabase, (data ?? []) as InvoiceRow[]);
}

export async function getCoachInvoices(ctx: InvoicingContext): Promise<InvoiceDTO[]> {
  const { supabase, userId } = ctx;
  const { coachId } = await requireCoach(supabase, userId);
  return loadInvoices(supabase, coachId);
}

/**
 * `GET /api/v1/coach/invoices` `[page]` (PRD §6.2 "Pagination"): the same
 * rows as `getCoachInvoices`, newest first, paged by an opaque cursor over
 * `(created_at, id)` — the composite key that already matches the query's
 * `created_at desc` ordering, so ties on `created_at` don't skip or repeat a
 * row across pages.
 */
export const invoicePageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(200).optional(),
});

/** Opaque, URL-safe page cursor: the oldest invoice of the page just served. */
export function encodeInvoiceCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAt, i: id }), "utf8").toString("base64url");
}

export function decodeInvoiceCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      c?: unknown;
      i?: unknown;
    };
    if (typeof parsed.c !== "string" || typeof parsed.i !== "string" || !parsed.c || !parsed.i) {
      throw new Error("shape");
    }
    if (Number.isNaN(Date.parse(parsed.c))) throw new Error("date");
    return { createdAt: parsed.c, id: parsed.i };
  } catch {
    throw new ApiError({ code: "validation_failed", status: 400, message: "Bad cursor." });
  }
}

export async function getCoachInvoicesPage(
  ctx: InvoicingContext,
  input: z.infer<typeof invoicePageQuery>,
): Promise<{ items: InvoiceDTO[]; nextCursor: string | null }> {
  const { supabase, userId } = ctx;
  const { coachId } = await requireCoach(supabase, userId);
  const before = input.cursor ? decodeInvoiceCursor(input.cursor) : null;

  let query = supabase
    .from("invoices")
    .select("id, athlete_id, period_start, period_end, total_cents, status, created_at")
    .eq("coach_id", coachId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (before) {
    query = query.or(
      `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
    );
  }

  const { data, error } = await query.limit(input.limit + 1);
  if (error) dbError(error);

  const rows = (data ?? []) as InvoiceRow[];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const oldest = page[page.length - 1];
  const nextCursor = hasMore && oldest ? encodeInvoiceCursor(oldest.created_at, oldest.id) : null;

  const items = await hydrateInvoiceRows(supabase, page);
  return { items, nextCursor };
}

export async function getAthleteBilling(
  ctx: InvoicingContext,
  athleteId: string,
): Promise<AthleteBillingDTO> {
  const { supabase, userId } = ctx;
  const { coachId } = await requireCoach(supabase, userId);
  await assertRostered(supabase, coachId, athleteId);

  const [{ data: rate, error: rErr }, invoices, names] = await Promise.all([
    supabase
      .from("coach_athlete_rates")
      .select("rate_kind, rate_cents")
      .eq("coach_id", coachId)
      .eq("athlete_id", athleteId)
      .maybeSingle(),
    loadInvoices(supabase, coachId, athleteId),
    athleteNameById(supabase, [athleteId]),
  ]);
  if (rErr) dbError(rErr);

  return {
    athleteId,
    athleteName: names.get(athleteId) ?? "Athlete",
    rate: rate ? { rateKind: rate.rate_kind as RateKind, rateCents: rate.rate_cents } : null,
    invoices,
  };
}

export async function getInvoiceDetail(
  ctx: InvoicingContext,
  invoiceId: string,
): Promise<InvoiceDTO & { lines: InvoiceLineDTO[] }> {
  const { supabase, userId } = ctx;
  const { coachId } = await requireCoach(supabase, userId);

  const { data: inv, error } = await supabase
    .from("invoices")
    .select("id, athlete_id, period_start, period_end, total_cents, status, created_at")
    .eq("id", invoiceId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (error) dbError(error);
  if (!inv) throw notFound("Invoice not found");

  type LineRow = {
    occurrence_date: string;
    amount_cents: number;
    is_group?: boolean | null;
    included_reason?: string | null;
  };
  const selectLines = (columns: string) =>
    supabase
      .from("invoice_lines")
      .select(columns)
      .eq("invoice_id", inv.id)
      .order("occurrence_date", { ascending: true }) as unknown as Promise<Rows<LineRow>>;
  // `is_group` arrives with migration 20261115120000; until then, the old columns.
  const loadLines = async () => {
    const res = await selectLines("occurrence_date, amount_cents, included_reason, is_group");
    return isMissingColumn(res.error) ? selectLines("occurrence_date, amount_cents") : res;
  };
  const [linesRes, names] = await Promise.all([
    loadLines(),
    athleteNameById(supabase, [inv.athlete_id]),
  ]);
  if (linesRes.error) dbError(linesRes.error);
  const lines = linesRes.data;

  return {
    id: inv.id,
    athleteId: inv.athlete_id,
    athleteName: names.get(inv.athlete_id) ?? "Athlete",
    periodStart: inv.period_start,
    periodEnd: inv.period_end,
    totalCents: inv.total_cents,
    status: inv.status as InvoiceStatus,
    createdAt: inv.created_at,
    lineCount: (lines ?? []).length,
    lines: (lines ?? []).map((l) => ({
      occurrenceDate: l.occurrence_date,
      amountCents: l.amount_cents,
      ...(l.is_group ? { group: true } : {}),
      ...(l.included_reason === "canceled_billed" ? { canceledBilled: true } : {}),
    })),
  };
}

// --- Draft generation -------------------------------------------------------

/** `POST /api/v1/coach/invoices/preview` body. */
export const previewInvoiceInput = z.object({
  athleteId: z.string().uuid(),
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
});

/**
 * Build the review-screen draft: every lesson occurrence in the window that
 * hasn't been invoiced yet, priced from the current rate and tagged with what
 * we know about whether it happened.
 */
async function buildPreview(
  supabase: Client,
  coachId: string,
  athleteId: string,
  periodStartInput: string | null,
  periodEndInput: string | null,
): Promise<InvoicePreviewDTO> {
  const [{ data: rateRow, error: rErr }, { data: lastInvoice, error: liErr }, names] =
    await Promise.all([
      supabase
        .from("coach_athlete_rates")
        .select("rate_kind, rate_cents")
        .eq("coach_id", coachId)
        .eq("athlete_id", athleteId)
        .maybeSingle(),
      supabase
        .from("invoices")
        .select("period_end")
        .eq("coach_id", coachId)
        .eq("athlete_id", athleteId)
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle(),
      athleteNameById(supabase, [athleteId]),
    ]);
  if (rErr) dbError(rErr);
  if (liErr) dbError(liErr);

  const rate = rateRow
    ? { rateKind: rateRow.rate_kind as RateKind, rateCents: rateRow.rate_cents }
    : null;

  const suggestedPeriodStart = lastInvoice
    ? toIsoDate(addDays(parseIsoDate(lastInvoice.period_end), 1))
    : null;

  const periodEnd = periodEndInput ?? toIsoDate(new Date());
  const fallbackStart = toIsoDate(addDays(parseIsoDate(periodEnd), -30));
  let periodStart = periodStartInput ?? suggestedPeriodStart ?? fallbackStart;
  if (parseIsoDate(periodStart) > parseIsoDate(periodEnd)) periodStart = periodEnd;
  // Guardrail: never expand an unbounded window.
  const floor = toIsoDate(addDays(parseIsoDate(periodEnd), -MAX_WINDOW_DAYS));
  if (parseIsoDate(periodStart) < parseIsoDate(floor)) periodStart = floor;

  type SlotRow = {
    id: string;
    day_of_week: number;
    start_minute: number;
    end_minute: number;
    frequency: string;
    weeks_of_month: number[] | null;
    starts_on: string | null;
    group_id?: string | null;
    price_cents?: number | null;
  };
  const SLOT_COLUMNS =
    "id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on";
  const selectSlots = (columns: string) =>
    supabase
      .from("athlete_lesson_slots")
      .select(columns)
      .eq("coach_id", coachId)
      .eq("athlete_id", athleteId) as unknown as Promise<Rows<SlotRow>>;
  // The group link and lesson price arrive with migration 20261115120000
  // (decision #68); until it is applied, the draft is built as before.
  let slotsRes = await selectSlots(`${SLOT_COLUMNS}, group_id, price_cents`);
  if (isMissingColumn(slotsRes.error)) slotsRes = await selectSlots(SLOT_COLUMNS);
  if (slotsRes.error) dbError(slotsRes.error);
  const slots = slotsRes.data;

  const slotRows = slots ?? [];
  const slotIds = slotRows.map((s) => s.id);

  type OverrideRow = {
    slot_id: string;
    occurrence_date: string;
    status: string;
    start_minute: number | null;
    end_minute: number | null;
    billable?: boolean | null;
  };
  const OVERRIDE_COLUMNS = "slot_id, occurrence_date, status, start_minute, end_minute";
  const selectOverrides = (columns: string) =>
    supabase
      .from("lesson_slot_overrides")
      .select(columns)
      .in("slot_id", slotIds)
      .gte("occurrence_date", periodStart)
      .lte("occurrence_date", periodEnd) as unknown as Promise<Rows<OverrideRow>>;
  const loadOverrides = async (): Promise<Rows<OverrideRow>> => {
    if (!slotIds.length) return { data: [], error: null };
    const res = await selectOverrides(`${OVERRIDE_COLUMNS}, billable`);
    return isMissingColumn(res.error) ? selectOverrides(OVERRIDE_COLUMNS) : res;
  };
  const [overridesRes, wrapUpsRes, invoicedRes] = await Promise.all([
    loadOverrides(),
    supabase
      .from("lesson_wrap_ups")
      .select("lesson_date, action")
      .eq("coach_id", coachId)
      .eq("athlete_id", athleteId)
      .gte("lesson_date", periodStart)
      .lte("lesson_date", periodEnd),
    supabase
      .from("invoices")
      .select("id, invoice_lines(occurrence_date, slot_id)")
      .eq("coach_id", coachId)
      .eq("athlete_id", athleteId),
  ]);
  if (overridesRes.error) dbError(overridesRes.error);
  if (wrapUpsRes.error) dbError(wrapUpsRes.error);
  if (invoicedRes.error) dbError(invoicedRes.error);

  const overrideByKey = new Map<
    string,
    { status: string; startMinute: number | null; endMinute: number | null; billable: boolean }
  >();
  for (const o of overridesRes.data ?? []) {
    overrideByKey.set(`${o.slot_id}::${o.occurrence_date}`, {
      status: o.status,
      startMinute: o.start_minute,
      endMinute: o.end_minute,
      billable: o.status === "canceled" && o.billable === true,
    });
  }

  const wrapUpByDate = new Map<string, string>();
  for (const w of wrapUpsRes.data ?? []) wrapUpByDate.set(w.lesson_date, w.action);

  const billed = billedIndex(invoicedRes.data as BilledInvoices);
  // A slot whose group has shrunk to one athlete is a private lesson.
  const liveGroups = await liveGroupIds(
    supabase as never,
    slotRows.map((s) => s.group_id).filter((id): id is string => id != null),
  );

  const lines: DraftLineDTO[] = [];
  for (const slot of slotRows) {
    const dates = expandSlotOccurrences(
      {
        dayOfWeek: slot.day_of_week,
        frequency: slot.frequency as LessonFrequency,
        weeksOfMonth: (slot.weeks_of_month ?? []) as number[],
        startsOn: slot.starts_on,
      },
      periodStart,
      periodEnd,
    );

    for (const date of dates) {
      if (billed.has(slot.id, date)) continue;
      const override = overrideByKey.get(`${slot.id}::${date}`);
      const startMinute =
        override?.status === "rescheduled" && override.startMinute != null
          ? override.startMinute
          : slot.start_minute;
      const endMinute =
        override?.status === "rescheduled" && override.endMinute != null
          ? override.endMinute
          : slot.end_minute;

      const wrapUp = wrapUpByDate.get(date);
      const billable = override?.status === "canceled" && override.billable;
      let state: DraftLineState = "scheduled";
      if (override?.status === "canceled") state = "canceled";
      else if (wrapUp === "did_not_happen") state = "did_not_happen";
      else if (wrapUp) state = "confirmed";

      lines.push({
        slotId: slot.id,
        occurrenceDate: date,
        startMinute,
        endMinute,
        // The lesson's own price wins over the athlete's rate (PRD §6.16 B);
        // nothing is ever split or recomputed from who turned up.
        amountCents:
          slot.price_cents != null
            ? slot.price_cents
            : rate
              ? amountForSlot(rate, startMinute, endMinute)
              : 0,
        state,
        // A canceled lesson the coach chose to bill is on the invoice by default.
        defaultIncluded: state === "confirmed" || state === "scheduled" || billable,
        ...(slot.group_id && liveGroups.has(slot.group_id) ? { group: true } : {}),
        ...(billable ? { billable: true } : {}),
      });
    }
  }

  lines.sort((a, b) =>
    a.occurrenceDate === b.occurrenceDate
      ? a.startMinute - b.startMinute
      : a.occurrenceDate.localeCompare(b.occurrenceDate),
  );

  return {
    athleteId,
    athleteName: names.get(athleteId) ?? "Athlete",
    rate,
    suggestedPeriodStart,
    periodStart,
    periodEnd,
    lines,
  };
}

export async function previewInvoice(
  ctx: InvoicingContext,
  data: z.infer<typeof previewInvoiceInput>,
): Promise<InvoicePreviewDTO> {
  const { supabase, userId } = ctx;
  const { coachId } = await requireCoach(supabase, userId);
  await assertRostered(supabase, coachId, data.athleteId);
  return buildPreview(supabase, coachId, data.athleteId, data.periodStart, data.periodEnd);
}

// --- Writes -----------------------------------------------------------------

/** `POST /api/v1/coach/invoices` body. `[idem]`: a retried create never double-bills. */
export const createInvoiceInput = z.object({
  athleteId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z
    .array(
      z.object({
        slotId: z.string().uuid().nullable().default(null),
        occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        startMinute: z.number().int().min(0).max(1440).nullable().default(null),
        endMinute: z.number().int().min(0).max(1440).nullable().default(null),
        amountCents: z.number().int().min(0).max(10_000_000),
        // "canceled_billed": a canceled lesson the coach billed anyway (decision #68).
        includedReason: z.enum(["completed", "manual_add", "canceled_billed"]).default("completed"),
        /** The lesson was a group lesson; kept on the line for the invoice text. */
        group: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(400),
});

/** The database half of decision #68 (migration 20261115120000) is not applied yet. */
const groupLessonsNotReady = () =>
  new ApiError({
    code: "unavailable",
    status: 503,
    message: "Group lessons aren't switched on yet. Try again shortly.",
  });

type BilledInvoices = Array<{
  invoice_lines: { occurrence_date: string; slot_id: string | null }[] | null;
}> | null;

/**
 * What is already on an invoice for this athlete. A lesson is billed once: by
 * its slot and date, so two lessons on one date (a private and a group
 * lesson, say) are each billable. A line with no slot (a manual add, or a
 * lesson whose slot has since been deleted) covers its whole date, as every
 * line did before decision #68.
 */
function billedIndex(invoices: BilledInvoices) {
  const dates = new Set<string>();
  const slotDates = new Set<string>();
  for (const inv of invoices ?? []) {
    for (const l of inv.invoice_lines ?? []) {
      if (l.slot_id) slotDates.add(`${l.slot_id}::${l.occurrence_date}`);
      else dates.add(l.occurrence_date);
    }
  }
  return {
    has(slotId: string | null, date: string): boolean {
      if (dates.has(date)) return true;
      if (slotId) return slotDates.has(`${slotId}::${date}`);
      // A manual line may not land on a date that already has a billed lesson.
      for (const key of slotDates) if (key.endsWith(`::${date}`)) return true;
      return false;
    },
  };
}

type CreateLine = z.infer<typeof createInvoiceInput>["lines"][number];

/**
 * The schedule's own answer, for the lines about to be billed, to "was this a
 * group lesson?" and "was this date canceled?". `migrated` is false while
 * migration 20261115120000 is not applied; then nothing is derived.
 */
async function lineFacts(
  supabase: Client,
  coachId: string,
  athleteId: string,
  lines: CreateLine[],
): Promise<{
  migrated: boolean;
  /** This athlete's lesson slots with this coach. */
  ownSlots: Set<string>;
  isGroup: (l: CreateLine) => boolean;
  reason: (l: CreateLine) => CreateLine["includedReason"];
}> {
  const selectSlots = (columns: string) =>
    supabase
      .from("athlete_lesson_slots")
      .select(columns)
      .eq("coach_id", coachId)
      .eq("athlete_id", athleteId) as unknown as Promise<
      Rows<{ id: string; group_id?: string | null }>
    >;
  let slotsRes = await selectSlots("id, group_id");
  const migrated = !isMissingColumn(slotsRes.error);
  if (!migrated) slotsRes = await selectSlots("id");
  if (slotsRes.error) dbError(slotsRes.error);
  const slots = slotsRes.data ?? [];
  const ownSlots = new Set(slots.map((s) => s.id));
  if (!migrated) {
    return { migrated, ownSlots, isGroup: () => false, reason: (l) => l.includedReason };
  }
  const live = await liveGroupIds(
    supabase as never,
    slots.map((s) => s.group_id).filter((id): id is string => id != null),
  );
  const groupSlots = new Set(
    slots.filter((s) => s.group_id && live.has(s.group_id)).map((s) => s.id),
  );

  const slotIds = [...new Set(lines.map((l) => l.slotId).filter((id): id is string => !!id))];
  const canceled = new Set<string>();
  if (slotIds.length) {
    const ovRes = await supabase
      .from("lesson_slot_overrides")
      .select("slot_id, occurrence_date, status")
      .in("slot_id", slotIds)
      .in("occurrence_date", [...new Set(lines.map((l) => l.occurrenceDate))])
      .eq("status", "canceled");
    if (ovRes.error) dbError(ovRes.error);
    for (const o of ovRes.data ?? []) canceled.add(`${o.slot_id}::${o.occurrence_date}`);
  }
  return {
    migrated: true,
    ownSlots,
    isGroup: (l) => l.slotId != null && groupSlots.has(l.slotId),
    reason: (l) => {
      if (l.includedReason === "manual_add" || !l.slotId) return l.includedReason;
      return canceled.has(`${l.slotId}::${l.occurrenceDate}`) ? "canceled_billed" : "completed";
    },
  };
}

export async function createInvoice(
  ctx: InvoicingContext,
  data: z.infer<typeof createInvoiceInput>,
): Promise<{ invoiceId: string; totalCents: number; lineCount: number }> {
  const { supabase, userId } = ctx;
  const { coachId } = await requireCoach(supabase, userId);
  await assertRostered(supabase, coachId, data.athleteId);

  // A date may only ever be billed once for this athlete — re-checked here
  // even though the client's preview already excluded invoiced dates, since
  // that draft can go stale between preview and submit.
  const { data: existing, error: exErr } = await supabase
    .from("invoices")
    .select("id, invoice_lines(occurrence_date, slot_id)")
    .eq("coach_id", coachId)
    .eq("athlete_id", data.athleteId);
  if (exErr) dbError(exErr);
  const billed = billedIndex(existing as BilledInvoices);
  const facts = await lineFacts(supabase, coachId, data.athleteId, data.lines);
  // A slot id that isn't one of this athlete's lessons with this coach (the
  // lesson was deleted since the preview, or the id is simply wrong) is
  // dropped: the line then covers its whole date, as a line with no slot does.
  const lines = data.lines.map((l) =>
    l.slotId && !facts.ownSlots.has(l.slotId) ? { ...l, slotId: null } : l,
  );
  const fresh = lines.filter((l) => !billed.has(l.slotId, l.occurrenceDate));
  if (fresh.length === 0) {
    throw unprocessable("Those sessions have already been invoiced.");
  }
  if (!facts.migrated && fresh.some((l) => l.includedReason === "canceled_billed" || l.group)) {
    throw groupLessonsNotReady();
  }

  const totalCents = fresh.reduce((sum, l) => sum + l.amountCents, 0);

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      coach_id: coachId,
      athlete_id: data.athleteId,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      total_cents: totalCents,
      status: "unpaid",
    })
    .select("id")
    .single();
  // The insert is scoped to the caller's own coach_id, so the roster clause of
  // "Coaches manage own invoices" is the only one that can fail with 42501 (an
  // athlete removed from the roster since the check above).
  if (error?.code === "42501") throw unprocessable("Athlete is not on your roster");
  if (error) dbError(error);

  const { error: lErr } = await supabase.from("invoice_lines").insert(
    fresh.map((l) => ({
      invoice_id: invoice!.id,
      // Also set by the invoice_lines_set_billing_ids trigger; included so
      // the generated NOT NULL column types are satisfied.
      coach_id: coachId,
      athlete_id: data.athleteId,
      slot_id: l.slotId,
      occurrence_date: l.occurrenceDate,
      start_minute: l.startMinute,
      end_minute: l.endMinute,
      amount_cents: l.amountCents,
      // Whether the lesson was canceled and whether it is a group lesson are
      // read from the schedule, not taken from the client: a build that
      // predates decision #68 sends "completed" and no group flag for both.
      included_reason: facts.reason(l),
      // Named on every row or on none (PostgREST fills a key missing from
      // some rows of a bulk insert with NULL, which `is_group` refuses), and
      // on none before migration 20261115120000.
      ...(facts.migrated ? { is_group: facts.isGroup(l) } : {}),
    })) as never,
  );
  if (lErr) {
    // Don't leave a header with no lines behind.
    await supabase.from("invoices").delete().eq("id", invoice!.id);
    // 23505 = unique_violation on invoice_lines_unique_athlete_occurrence_idx
    // (coach_id, athlete_id, occurrence_date, slot_id): a concurrent create
    // for this athlete billed one of these dates onto another invoice
    // between the check above and this insert. Same friendly error as the
    // non-concurrent case, not a raw DB error.
    if (lErr.code === "23505") {
      throw unprocessable("Those sessions have already been invoiced.");
    }
    // Migration 20261115120000 only part-way in (or PostgREST's schema cache
    // not reloaded yet): `is_group` or the new reason isn't accepted.
    if (facts.migrated && (isMissingColumn(lErr) || lErr.code === "23514")) {
      throw groupLessonsNotReady();
    }
    dbError(lErr);
  }

  return { invoiceId: invoice!.id, totalCents, lineCount: fresh.length };
}

/** `PATCH /api/v1/coach/invoices/{id}/status` body (the invoice id is in the path). */
export const setInvoiceStatusBody = z.object({
  status: z.enum(["unpaid", "paid"]),
});

export async function setInvoiceStatus(
  ctx: InvoicingContext,
  invoiceId: string,
  data: z.infer<typeof setInvoiceStatusBody>,
): Promise<{ ok: true }> {
  const { supabase, userId } = ctx;
  const { coachId } = await requireCoach(supabase, userId);

  const { data: updated, error } = await supabase
    .from("invoices")
    .update({
      status: data.status,
      paid_at: data.status === "paid" ? new Date().toISOString() : null,
    })
    .eq("id", invoiceId)
    .eq("coach_id", coachId)
    .select("id")
    .maybeSingle();
  if (error) dbError(error);
  if (!updated) throw notFound("Invoice not found");
  return { ok: true as const };
}

export async function deleteInvoice(
  ctx: InvoicingContext,
  invoiceId: string,
): Promise<{ ok: true }> {
  const { supabase, userId } = ctx;
  const { coachId } = await requireCoach(supabase, userId);

  const { data: inv, error } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", invoiceId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (error) dbError(error);
  if (!inv) throw notFound("Invoice not found");
  if (inv.status === "paid") throw unprocessable("Paid invoices can't be deleted.");

  const { error: dErr } = await supabase
    .from("invoices")
    .delete()
    .eq("id", inv.id)
    .eq("coach_id", coachId);
  if (dErr) dbError(dErr);
  return { ok: true as const };
}
