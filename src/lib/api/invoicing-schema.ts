/**
 * Zod schemas for the invoicing DTOs, mirroring `invoicing.server.ts` field
 * for field (`satisfies` keeps them honest), so the OpenAPI document and the
 * generated Swift client carry the real shapes. Coach-only, per PRD §7.11
 * "Billing and invoicing" — there is no parent- or athlete-facing schema
 * here.
 */
import { z } from "zod";
import type {
  AthleteBillingDTO,
  AthleteRateDTO,
  DraftLineDTO,
  InvoiceDTO,
  InvoiceLineDTO,
  InvoicePreviewDTO,
} from "@/lib/invoicing.server";

export const rateKindSchema = z.enum(["per_session", "hourly"]);
export const invoiceStatusSchema = z.enum(["unpaid", "paid"]);
export const draftLineStateSchema = z.enum([
  "confirmed",
  "scheduled",
  "did_not_happen",
  "canceled",
]);

export const athleteRateSchema = z.object({
  rateKind: rateKindSchema,
  rateCents: z.number(),
}) satisfies z.ZodType<AthleteRateDTO>;

export const draftLineSchema = z.object({
  slotId: z.string(),
  occurrenceDate: z.string(),
  startMinute: z.number(),
  endMinute: z.number(),
  amountCents: z.number(),
  state: draftLineStateSchema,
  defaultIncluded: z.boolean(),
  // Decision #68: optional so an older build decodes the draft unchanged.
  group: z.boolean().optional(),
  billable: z.boolean().optional(),
}) satisfies z.ZodType<DraftLineDTO>;

export const invoicePreviewSchema = z.object({
  athleteId: z.string(),
  athleteName: z.string(),
  rate: athleteRateSchema.nullable(),
  suggestedPeriodStart: z.string().nullable(),
  periodStart: z.string(),
  periodEnd: z.string(),
  lines: z.array(draftLineSchema),
}) satisfies z.ZodType<InvoicePreviewDTO>;

export const invoiceLineSchema = z.object({
  occurrenceDate: z.string(),
  amountCents: z.number(),
  group: z.boolean().optional(),
  canceledBilled: z.boolean().optional(),
}) satisfies z.ZodType<InvoiceLineDTO>;

export const invoiceSchema = z.object({
  id: z.string(),
  athleteId: z.string(),
  athleteName: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  totalCents: z.number(),
  status: invoiceStatusSchema,
  createdAt: z.string(),
  lineCount: z.number(),
  // Decision #69: the ISO 4217 code the invoice was created in. Optional so an
  // older build decodes the invoice unchanged, and absent until the migration
  // is applied; a string, not an enum, so a currency added later still decodes.
  currency: z.string().optional(),
}) satisfies z.ZodType<InvoiceDTO>;

export const invoiceDetailSchema = invoiceSchema.extend({
  lines: z.array(invoiceLineSchema),
}) satisfies z.ZodType<InvoiceDTO & { lines: InvoiceLineDTO[] }>;

export const athleteBillingSchema = z.object({
  athleteId: z.string(),
  athleteName: z.string(),
  rate: athleteRateSchema.nullable(),
  invoices: z.array(invoiceSchema),
}) satisfies z.ZodType<AthleteBillingDTO>;

/** `GET /api/v1/coach/invoices` `[page]` response. */
export const invoicePageSchema = z.object({
  items: z.array(invoiceSchema),
  nextCursor: z.string().nullable(),
});

export const createInvoiceResultSchema = z.object({
  invoiceId: z.string(),
  totalCents: z.number(),
  lineCount: z.number(),
  // Decision #69: the code the database stamped on the new invoice, so the
  // caller labels it from the invoice and not from its own copy of the coach's
  // setting. Optional and a string for the reasons given on `invoiceSchema`.
  currency: z.string().optional(),
});
