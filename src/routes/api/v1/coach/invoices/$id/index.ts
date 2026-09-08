import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { invoiceDetailSchema } from "@/lib/api/invoicing-schema";
import { deleteInvoice, getInvoiceDetail } from "@/lib/invoicing.server";

const invoiceId = (params: Record<string, string>) => z.string().uuid().parse(params.id);

/** Thin wrappers over the shared `getInvoiceDetail` and `deleteInvoice` (PRD §7.11 "Billing and invoicing"). */
export const Route = createFileRoute("/api/v1/coach/invoices/$id/")({
  server: {
    handlers: {
      ...defineApiRoute({
        method: "GET",
        path: "/api/v1/coach/invoices/{id}",
        operationId: "getInvoiceDetail",
        auth: "user",
        summary: "One invoice with its line items",
        output: invoiceDetailSchema,
        handler: async ({ ctx, params }) => {
          const { userId, supabase } = requireContext(ctx);
          return getInvoiceDetail({ userId, supabase }, invoiceId(params));
        },
      }),
      ...defineApiRoute({
        method: "DELETE",
        path: "/api/v1/coach/invoices/{id}",
        operationId: "deleteInvoice",
        auth: "user",
        summary: "Delete an unpaid invoice",
        output: okSchema,
        handler: async ({ ctx, params }) => {
          const { userId, supabase } = requireContext(ctx);
          return deleteInvoice({ userId, supabase }, invoiceId(params));
        },
      }),
    },
  },
});
