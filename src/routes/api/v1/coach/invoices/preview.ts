import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { invoicePreviewSchema } from "@/lib/api/invoicing-schema";
import { previewInvoice, previewInvoiceInput } from "@/lib/invoicing.server";

/** Thin wrapper over the shared `previewInvoice` (PRD §7.11 "Billing and invoicing"). */
export const Route = createFileRoute("/api/v1/coach/invoices/preview")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/coach/invoices/preview",
      operationId: "previewInvoice",
      auth: "user",
      summary: "Draft an invoice's line items from lesson occurrences",
      input: previewInvoiceInput,
      output: invoicePreviewSchema,
      handler: async ({ ctx, input }) => {
        const { userId, supabase } = requireContext(ctx);
        return previewInvoice({ userId, supabase }, input);
      },
    }),
  },
});
