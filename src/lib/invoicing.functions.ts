import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { computeEffectiveTier, type CoachEffectiveTier } from "./coach-profile.functions";
import {
  addDays,
  expandSlotOccurrences,
  parseIsoDate,
  toIsoDate,
  type LessonFrequency,
} from "./lesson-recurrence";

type Client = SupabaseClient<Database>;

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

async function requireProCoach(
  supabase: Client,
  userId: string,
): Promise<{ coachId: string; tier: CoachEffectiveTier }> {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("id, organization_id, subscription_tier")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new Error("Coach profile not found");
  const tier = computeEffectiveTier({
    organizationId: data.organization_id,
    subscriptionTier: (data.subscription_tier as "coach" | "coach_pro" | null) ?? null,
  });
  if (tier === "coach") {
    throw new Error("Invoicing is available on Coach Pro and Club plans.");
  }
  return { coachId: data.id, tier };
}

async function assertRostered(supabase: Client, coachId: string, athleteId: string) {
  const { data, error } = await supabase
    .from("coach_athletes")
    .select("id")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new Error("Athlete is not on your roster");
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

export const setAthleteRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        athleteId: z.string().uuid(),
        rateKind: z.enum(["per_session", "hourly"]),
        rateCents: z.number().int().min(0).max(10_000_000),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const { coachId } = await requireProCoach(supabase, context.userId);
    await assertRostered(supabase, coachId, data.athleteId);

    const { error } = await supabase.from("coach_athlete_rates").upsert(
      {
        coach_id: coachId,
        athlete_id: data.athleteId,
        rate_kind: data.rateKind,
        rate_cents: data.rateCents,
      },
      { onConflict: "coach_id,athlete_id" },
    );
    if (error) dbError(error);
    return { ok: true as const };
  });

// --- Reads ------------------------------------------------------------------

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
  const rows = data ?? [];
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

export const getCoachInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InvoiceDTO[]> => {
    const supabase = context.supabase as Client;
    // Read-only list: if the coach isn't entitled, return an empty list rather
    // than throwing — the UI already renders the locked state.
    let coachId: string;
    try {
      ({ coachId } = await requireProCoach(supabase, context.userId));
    } catch {
      return [];
    }
    return loadInvoices(supabase, coachId);
  });

export const getAthleteBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ athleteId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }): Promise<AthleteBillingDTO> => {
    const supabase = context.supabase as Client;
    const { coachId } = await requireProCoach(supabase, context.userId);
    await assertRostered(supabase, coachId, data.athleteId);

    const [{ data: rate, error: rErr }, invoices, names] = await Promise.all([
      supabase
        .from("coach_athlete_rates")
        .select("rate_kind, rate_cents")
        .eq("coach_id", coachId)
        .eq("athlete_id", data.athleteId)
        .maybeSingle(),
      loadInvoices(supabase, coachId, data.athleteId),
      athleteNameById(supabase, [data.athleteId]),
    ]);
    if (rErr) dbError(rErr);

    return {
      athleteId: data.athleteId,
      athleteName: names.get(data.athleteId) ?? "Athlete",
      rate: rate ? { rateKind: rate.rate_kind as RateKind, rateCents: rate.rate_cents } : null,
      invoices,
    };
  });

export const getInvoiceDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ invoiceId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }): Promise<InvoiceDTO & { lines: InvoiceLineDTO[] }> => {
    const supabase = context.supabase as Client;
    const { coachId } = await requireProCoach(supabase, context.userId);

    const { data: inv, error } = await supabase
      .from("invoices")
      .select("id, athlete_id, period_start, period_end, total_cents, status, created_at")
      .eq("id", data.invoiceId)
      .eq("coach_id", coachId)
      .maybeSingle();
    if (error) dbError(error);
    if (!inv) throw new Error("Invoice not found");

    const [{ data: lines, error: lErr }, names] = await Promise.all([
      supabase
        .from("invoice_lines")
        .select("occurrence_date, amount_cents")
        .eq("invoice_id", inv.id)
        .order("occurrence_date", { ascending: true }),
      athleteNameById(supabase, [inv.athlete_id]),
    ]);
    if (lErr) dbError(lErr);

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
      })),
    };
  });

// --- Draft generation -------------------------------------------------------

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

  const { data: slots, error: sErr } = await supabase
    .from("athlete_lesson_slots")
    .select("id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId);
  if (sErr) dbError(sErr);

  const slotRows = slots ?? [];
  const slotIds = slotRows.map((s) => s.id);

  const [overridesRes, wrapUpsRes, invoicedRes] = await Promise.all([
    slotIds.length
      ? supabase
          .from("lesson_slot_overrides")
          .select("slot_id, occurrence_date, status, start_minute, end_minute")
          .in("slot_id", slotIds)
          .gte("occurrence_date", periodStart)
          .lte("occurrence_date", periodEnd)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("lesson_wrap_ups")
      .select("lesson_date, action")
      .eq("coach_id", coachId)
      .eq("athlete_id", athleteId)
      .gte("lesson_date", periodStart)
      .lte("lesson_date", periodEnd),
    supabase
      .from("invoices")
      .select("id, invoice_lines(occurrence_date)")
      .eq("coach_id", coachId)
      .eq("athlete_id", athleteId),
  ]);
  if (overridesRes.error) dbError(overridesRes.error);
  if (wrapUpsRes.error) dbError(wrapUpsRes.error);
  if (invoicedRes.error) dbError(invoicedRes.error);

  const overrideByKey = new Map<
    string,
    { status: string; startMinute: number | null; endMinute: number | null }
  >();
  for (const o of overridesRes.data ?? []) {
    overrideByKey.set(`${o.slot_id}::${o.occurrence_date}`, {
      status: o.status,
      startMinute: o.start_minute,
      endMinute: o.end_minute,
    });
  }

  const wrapUpByDate = new Map<string, string>();
  for (const w of wrapUpsRes.data ?? []) wrapUpByDate.set(w.lesson_date, w.action);

  const alreadyInvoiced = new Set<string>();
  for (const inv of (invoicedRes.data ?? []) as Array<{
    invoice_lines: { occurrence_date: string }[] | null;
  }>) {
    for (const l of inv.invoice_lines ?? []) alreadyInvoiced.add(l.occurrence_date);
  }

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
      if (alreadyInvoiced.has(date)) continue;
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
      let state: DraftLineState = "scheduled";
      if (override?.status === "canceled") state = "canceled";
      else if (wrapUp === "did_not_happen") state = "did_not_happen";
      else if (wrapUp) state = "confirmed";

      lines.push({
        slotId: slot.id,
        occurrenceDate: date,
        startMinute,
        endMinute,
        amountCents: rate ? amountForSlot(rate, startMinute, endMinute) : 0,
        state,
        defaultIncluded: state === "confirmed" || state === "scheduled",
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

export const previewInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
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
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<InvoicePreviewDTO> => {
    const supabase = context.supabase as Client;
    const { coachId } = await requireProCoach(supabase, context.userId);
    await assertRostered(supabase, coachId, data.athleteId);
    return buildPreview(supabase, coachId, data.athleteId, data.periodStart, data.periodEnd);
  });

// --- Writes -----------------------------------------------------------------

export const createInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
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
              includedReason: z.enum(["completed", "manual_add"]).default("completed"),
            }),
          )
          .min(1)
          .max(400),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const { coachId } = await requireProCoach(supabase, context.userId);
    await assertRostered(supabase, coachId, data.athleteId);

    // A date may only ever be billed once for this athlete.
    const { data: existing, error: exErr } = await supabase
      .from("invoices")
      .select("id, invoice_lines(occurrence_date)")
      .eq("coach_id", coachId)
      .eq("athlete_id", data.athleteId);
    if (exErr) dbError(exErr);
    const billed = new Set<string>();
    for (const inv of (existing ?? []) as Array<{
      invoice_lines: { occurrence_date: string }[] | null;
    }>) {
      for (const l of inv.invoice_lines ?? []) billed.add(l.occurrence_date);
    }
    const fresh = data.lines.filter((l) => !billed.has(l.occurrenceDate));
    if (fresh.length === 0) {
      throw new Error("Those sessions have already been invoiced.");
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
    if (error) dbError(error);

    const { error: lErr } = await supabase.from("invoice_lines").insert(
      fresh.map((l) => ({
        invoice_id: invoice!.id,
        slot_id: l.slotId,
        occurrence_date: l.occurrenceDate,
        start_minute: l.startMinute,
        end_minute: l.endMinute,
        amount_cents: l.amountCents,
        included_reason: l.includedReason,
      })),
    );
    if (lErr) {
      // Don't leave a header with no lines behind.
      await supabase.from("invoices").delete().eq("id", invoice!.id);
      dbError(lErr);
    }

    return { invoiceId: invoice!.id, totalCents, lineCount: fresh.length };
  });

export const setInvoiceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        invoiceId: z.string().uuid(),
        status: z.enum(["unpaid", "paid"]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const { coachId } = await requireProCoach(supabase, context.userId);

    const { error } = await supabase
      .from("invoices")
      .update({
        status: data.status,
        paid_at: data.status === "paid" ? new Date().toISOString() : null,
      })
      .eq("id", data.invoiceId)
      .eq("coach_id", coachId);
    if (error) dbError(error);
    return { ok: true as const };
  });

export const deleteInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ invoiceId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const { coachId } = await requireProCoach(supabase, context.userId);

    const { data: inv, error } = await supabase
      .from("invoices")
      .select("id, status")
      .eq("id", data.invoiceId)
      .eq("coach_id", coachId)
      .maybeSingle();
    if (error) dbError(error);
    if (!inv) throw new Error("Invoice not found");
    if (inv.status === "paid") throw new Error("Paid invoices can't be deleted.");

    const { error: dErr } = await supabase
      .from("invoices")
      .delete()
      .eq("id", inv.id)
      .eq("coach_id", coachId);
    if (dErr) dbError(dErr);
    return { ok: true as const };
  });
