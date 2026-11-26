import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute, type DefineApiRouteOptions } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import { setInvoiceCurrency, setInvoiceCurrencyInput } from "@/lib/invoice-currency.server";

const outputSchema = z.object({
  /** The stored ISO 4217 code, as `GET /me` now reports it. */
  invoiceCurrency: z.string(),
});

/**
 * Sets the currency the coach invoices in (decision #69; Settings → Invoice
 * currency): one of USD, CAD, AUD, NZD, GBP. Display only: nothing is
 * converted. Invoices created from now on are in it; earlier ones keep theirs.
 * `GET /me` carries the current value (`invoiceCurrency`).
 *
 * Coach only: 403 `wrong_role` for an account with no coach row (never
 * creates one). 503 `unavailable` until the database half (migration
 * 20261121120000) is applied, never a silent success.
 *
 * No `idempotent: true`, as `PUT /me/ai-consent`: setting a value is already
 * safe to repeat, and a stored 24-hour replay could answer a late retry of an
 * older choice with that older value after a newer one was saved.
 *
 * The options are a function (as `passwordRouteOptions` is) so
 * src/lib/api/me-routes.test.ts can run the route through
 * `createApiRouteHandler`.
 */
export function putMeInvoiceCurrencyRouteOptions(): DefineApiRouteOptions<
  z.infer<typeof setInvoiceCurrencyInput>,
  z.infer<typeof outputSchema>
> {
  return {
    method: "PUT",
    path: "/api/v1/me/invoice-currency",
    operationId: "putMeInvoiceCurrency",
    auth: "user",
    summary: "Set the currency the coach invoices in",
    input: setInvoiceCurrencyInput,
    output: outputSchema,
    handler: async ({ ctx, input }) => {
      const { userId, supabase } = requireContext(ctx);
      return setInvoiceCurrency({ userId, supabase }, input);
    },
  };
}

export const Route = createFileRoute("/api/v1/me/invoice-currency")({
  server: {
    handlers: defineApiRoute(putMeInvoiceCurrencyRouteOptions()),
  },
});
