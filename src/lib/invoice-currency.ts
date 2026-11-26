/**
 * The currencies a coach can invoice in (decision #69): one per coach, set in
 * Settings, display only. Nothing is converted and no payment depends on it.
 * All five are two-decimal, dot-decimal, symbol-before-amount currencies. The
 * database checks the same list on `coach_profiles.invoice_currency` (migration
 * 20261121120000; `invoices.currency` only ever copies it), so adding one
 * means a migration widening that one constraint as well as a line here.
 *
 * Client-safe: no server imports.
 */
export const INVOICE_CURRENCY_CODES = ["USD", "CAD", "AUD", "NZD", "GBP"] as const;

export type InvoiceCurrencyCode = (typeof INVOICE_CURRENCY_CODES)[number];

/** What an amount reads as when nothing says otherwise: a missing value is US dollars. */
export const DEFAULT_INVOICE_CURRENCY: InvoiceCurrencyCode = "USD";

/**
 * The symbol written directly before an amount. Four of the five share "$",
 * which is why a shared invoice's Total line also names the code when it is
 * not US dollars (see `buildInvoiceText` in invoice-format.ts).
 */
export const INVOICE_CURRENCY_SYMBOLS: Record<InvoiceCurrencyCode, string> = {
  USD: "$",
  CAD: "$",
  AUD: "$",
  NZD: "$",
  GBP: "£",
};

/**
 * The currency an invoice's amounts are shown in: the one the invoice was
 * created in when it carries one, otherwise the coach's current one, otherwise
 * US dollars. Rates, drafts and running totals have no currency of their own,
 * so they pass only the coach's.
 */
export function displayCurrency(
  invoiceCurrency: string | null | undefined,
  coachCurrency: string | null | undefined,
): string {
  return invoiceCurrency || coachCurrency || DEFAULT_INVOICE_CURRENCY;
}
