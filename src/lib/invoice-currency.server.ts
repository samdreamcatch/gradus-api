/**
 * A coach's invoice currency (decision #69): `coach_profiles.invoice_currency`,
 * one per coach, set in Settings. Display only: nothing is converted. Each
 * invoice keeps the currency it was created in (`invoices.currency`, stamped
 * by a database trigger; see invoicing.server.ts).
 *
 * The column arrives with migration 20261121120000, which Lovable applies
 * before or after this code is deployed. So it is never added to a shared
 * select (`PROFILE_COLUMNS`, `/me`'s coach read): it is read here with its own
 * query, and the write answers 503 until the column exists.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError, isMissingColumn } from "./db-error";
import { INVOICE_CURRENCY_CODES } from "./invoice-currency";

type Client = SupabaseClient<Database>;

type CurrencyFields = { invoice_currency: string };
type CoachTable = Database["public"]["Tables"]["coach_profiles"];
type CurrencyDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<Database["public"]["Tables"], "coach_profiles"> & {
      coach_profiles: Omit<CoachTable, "Row" | "Insert" | "Update"> & {
        Row: CoachTable["Row"] & CurrencyFields;
        Insert: CoachTable["Insert"] & Partial<CurrencyFields>;
        Update: CoachTable["Update"] & Partial<CurrencyFields>;
      };
    };
  };
};

// Local schema extension for migration 20261121120000 (the `plansTable`
// pattern): the generated types gain the column once Lovable regenerates them,
// and until then every read or write of it goes through here. Keeps the
// caller's client, so a user-scoped client stays under RLS.
function coachProfilesTable(client: Client) {
  return (client as unknown as SupabaseClient<CurrencyDatabase>).from("coach_profiles");
}

/** `PUT /api/v1/me/invoice-currency` body. */
export const setInvoiceCurrencyInput = z.object({
  currency: z.enum(INVOICE_CURRENCY_CODES),
});

/** The database half of decision #69 (migration 20261121120000) is not applied yet. */
const invoiceCurrencyNotReady = () =>
  new ApiError({
    code: "unavailable",
    status: 503,
    message: "Invoice currency isn't switched on yet. Try again shortly.",
  });

/** The refusal `GET /coach/billing` gives an account with no coach row. */
const notACoach = () =>
  new ApiError({ code: "wrong_role", status: 403, message: "This account is not a coach." });

/** What one read of the column found. */
type InvoiceCurrencyRead =
  | { state: "set"; currency: string }
  /** No coach row, or the column isn't there yet. Nothing is wrong. */
  | { state: "none" }
  /** The read itself failed (logged). */
  | { state: "failed" };

// The missing-column warning is logged once per isolate, not on every read:
// until the migration is applied every coach's `/me` and every web invoicing
// screen takes that path, and one line is enough of a trace.
let warnedMissingColumn = false;

/** Test-only: lets the next missing-column read warn again. */
export function resetInvoiceCurrencyWarning(): void {
  warnedMissingColumn = false;
}

/** One read of `coach_profiles.invoice_currency`, with its own query. Never throws. */
async function readInvoiceCurrency(client: Client, userId: string): Promise<InvoiceCurrencyRead> {
  try {
    const { data, error } = await coachProfilesTable(client)
      .select("invoice_currency")
      .eq("user_id", userId)
      .maybeSingle();
    if (isMissingColumn(error)) {
      // The expected state until the migration is applied, so not an error;
      // warned so a migration that is never applied still leaves a trace.
      if (!warnedMissingColumn) {
        warnedMissingColumn = true;
        console.warn(
          "[invoice-currency] coach_profiles.invoice_currency is missing: migration 20261121120000 is not applied",
        );
      }
      return { state: "none" };
    }
    if (error) {
      console.error("[invoice-currency] read", error);
      return { state: "failed" };
    }
    const code: unknown = data?.invoice_currency;
    return typeof code === "string" && code ? { state: "set", currency: code } : { state: "none" };
  } catch (err) {
    console.error("[invoice-currency] read", err);
    return { state: "failed" };
  }
}

/**
 * The invoice currency of the coach behind `userId`, as stored: one of
 * `INVOICE_CURRENCY_CODES` today, but returned as it is so a currency added by
 * a later migration passes through.
 *
 * `undefined` when it isn't known: the account has no coach row, the column
 * isn't there yet (warned, once per isolate), or the read failed for any
 * reason (logged). It never answers "USD" on its own and never throws, so a
 * caller can read it beside other things (`GET /me`) without it failing them.
 */
export async function getInvoiceCurrency(
  client: Client,
  userId: string,
): Promise<string | undefined> {
  const read = await readInvoiceCurrency(client, userId);
  return read.state === "set" ? read.currency : undefined;
}

/**
 * The same read for a caller that keeps the answer (the web invoicing screens
 * cache it): `null` when there is nothing to show (no coach row, or the column
 * isn't there yet), and a thrown error when the read failed, so a failure is
 * retried instead of being kept as "no currency" and shown as US dollars.
 */
export async function getInvoiceCurrencyOrFail(
  client: Client,
  userId: string,
): Promise<string | null> {
  const read = await readInvoiceCurrency(client, userId);
  if (read.state === "failed") throw new Error("Couldn't load your invoice currency.");
  return read.state === "set" ? read.currency : null;
}

/**
 * Sets the caller's own invoice currency, through their user-scoped client:
 * the "Coaches can update own profile" policy lets a coach update their own
 * `coach_profiles` row and nobody else's, and neither protection trigger on
 * the table lists this column. Later invoices are created in it; earlier ones
 * keep theirs.
 *
 * 403 `wrong_role` without a coach row (never creates one); 503 `unavailable`
 * while the column is missing, never a silent success. Naturally idempotent.
 */
export async function setInvoiceCurrency(
  ctx: { userId: string; supabase: Client },
  data: z.infer<typeof setInvoiceCurrencyInput>,
): Promise<{ invoiceCurrency: string }> {
  const { supabase, userId } = ctx;
  const coach = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) throw notACoach();

  const { data: saved, error } = await coachProfilesTable(supabase)
    .update({ invoice_currency: data.currency })
    .eq("id", coach.data.id)
    .eq("user_id", userId)
    .select("invoice_currency")
    .maybeSingle();
  if (isMissingColumn(error)) throw invoiceCurrencyNotReady();
  if (error) dbError(error);
  // The row went away between the two statements (the account was deleted).
  if (!saved) throw notACoach();
  return { invoiceCurrency: saved.invoice_currency };
}
