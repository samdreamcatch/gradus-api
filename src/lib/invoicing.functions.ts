import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { rethrowPlain } from "./api/errors";
import {
  createInvoice as createInvoiceImpl,
  createInvoiceInput,
  deleteInvoice as deleteInvoiceImpl,
  getAthleteBilling as getAthleteBillingImpl,
  getCoachInvoices as getCoachInvoicesImpl,
  getInvoiceDetail as getInvoiceDetailImpl,
  previewInvoice as previewInvoiceImpl,
  previewInvoiceInput,
  setAthleteRate as setAthleteRateImpl,
  setAthleteRateBody,
  setInvoiceStatus as setInvoiceStatusImpl,
  setInvoiceStatusBody,
} from "./invoicing.server";

// Re-export types so existing web imports keep working.
export type {
  RateKind,
  InvoiceStatus,
  DraftLineState,
  AthleteRateDTO,
  DraftLineDTO,
  InvoicePreviewDTO,
  InvoiceLineDTO,
  InvoiceDTO,
  AthleteBillingDTO,
} from "./invoicing.server";

type Client = SupabaseClient<Database>;

/*
 * Thin wrappers over the shared entry points in src/lib/invoicing.server.ts,
 * shared with the `/api/v1/coach/athletes/{id}/rate`,
 * `/api/v1/coach/athletes/{id}/billing`, and `/api/v1/coach/invoices*`
 * routes. Behavior and error messages are unchanged.
 */

// --- Rate -------------------------------------------------------------------

export const setAthleteRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    setAthleteRateBody.extend({ athleteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    try {
      return await setAthleteRateImpl(
        { userId: context.userId, supabase: context.supabase as Client },
        data.athleteId,
        { rateKind: data.rateKind, rateCents: data.rateCents },
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

// --- Reads ------------------------------------------------------------------

export const getCoachInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await getCoachInvoicesImpl({
        userId: context.userId,
        supabase: context.supabase as Client,
      });
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const getAthleteBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ athleteId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await getAthleteBillingImpl(
        { userId: context.userId, supabase: context.supabase as Client },
        data.athleteId,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const getInvoiceDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ invoiceId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await getInvoiceDetailImpl(
        { userId: context.userId, supabase: context.supabase as Client },
        data.invoiceId,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

// --- Draft generation --------------------------------------------------------

export const previewInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => previewInvoiceInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await previewInvoiceImpl(
        { userId: context.userId, supabase: context.supabase as Client },
        data,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

// --- Writes -----------------------------------------------------------------

export const createInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createInvoiceInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await createInvoiceImpl(
        { userId: context.userId, supabase: context.supabase as Client },
        data,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const setInvoiceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    setInvoiceStatusBody.extend({ invoiceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    try {
      return await setInvoiceStatusImpl(
        { userId: context.userId, supabase: context.supabase as Client },
        data.invoiceId,
        { status: data.status },
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const deleteInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ invoiceId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await deleteInvoiceImpl(
        { userId: context.userId, supabase: context.supabase as Client },
        data.invoiceId,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });
