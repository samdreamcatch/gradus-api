import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { getInvoiceCurrencyOrFail } from "./invoice-currency.server";

type Client = SupabaseClient<Database>;

/**
 * The signed-in coach's invoice currency (decision #69) for the web invoicing
 * screens: the same read `GET /api/v1/me` reports as `invoiceCurrency`, through
 * the caller's own client. `null` when there is none to show (no coach row, or
 * the column's migration not applied yet); the screens then show US dollars.
 * A read that fails throws instead, so the screens retry it and never cache
 * "none" for a coach who has one. The web has no control to change it in this
 * pass: it is set in the app's Settings.
 */
export const getMyInvoiceCurrency = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({
    invoiceCurrency: await getInvoiceCurrencyOrFail(context.supabase as Client, context.userId),
  }));
