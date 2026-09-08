import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { okSchema } from "@/lib/api/onboarding-schema";
import { setInvoiceStatus, setInvoiceStatusBody } from "@/lib/invoicing.server";

/** Thin wrapper over the shared `setInvoiceStatus` (PRD §7.11 "Billing and invoicing"). */
export const Route = createFileRoute("/api/v1/coach/invoices/$id/status")({
  server: {
    handlers: defineApiRoute({
      method: "PATCH",
      path: "/api/v1/coach/invoices/{id}/status",
      operationId: "setInvoiceStatus",
      auth: "user",
      summary: "Mark an invoice paid or unpaid",
      input: setInvoiceStatusBody,
      output: okSchema,
      handler: async ({ ctx, input, params }) => {
        const { userId, supabase } = requireContext(ctx);
        return setInvoiceStatus({ userId, supabase }, z.string().uuid().parse(params.id), input);
      },
    }),
  },
});
