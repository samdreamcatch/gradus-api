import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { createInvoiceResultSchema, invoicePageSchema } from "@/lib/api/invoicing-schema";
import {
  createInvoice,
  createInvoiceInput,
  getCoachInvoicesPage,
  invoicePageQuery,
} from "@/lib/invoicing.server";

/**
 * Thin wrappers over the shared `getCoachInvoicesPage` and `createInvoice`
 * (PRD §7.11 "Billing and invoicing").
 *
 * `GET` `[page]`: `?limit=50&cursor=<opaque>` returns `{ items, nextCursor }`,
 * newest invoice first — see `getCoachInvoicesPage` in
 * `src/lib/invoicing.server.ts` for the cursor convention.
 *
 * `POST` `[idem]`: a retried create replays the stored response instead of
 * inserting the invoice twice.
 */
export const Route = createFileRoute("/api/v1/coach/invoices/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/coach/invoices",
        operationId: "getCoachInvoices",
        auth: "user",
        summary: "One page of the coach's invoices, newest first",
        query: invoicePageQuery,
        output: invoicePageSchema,
        handler: async ({ ctx, query }) => {
          const { userId, supabase } = requireContext(ctx);
          return getCoachInvoicesPage({ userId, supabase }, query);
        },
      }),
      ...defineApiRoute({
        method: "POST",
        path: "/api/v1/coach/invoices",
        operationId: "createInvoice",
        auth: "user",
        idempotent: true,
        summary: "Create an invoice from a set of draft lines",
        input: createInvoiceInput,
        output: createInvoiceResultSchema,
        handler: async ({ ctx, input }) => {
          const { userId, supabase } = requireContext(ctx);
          return createInvoice({ userId, supabase }, input);
        },
      }),
    },
  },
});
