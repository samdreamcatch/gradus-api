import {
  DEFAULT_INVOICE_CURRENCY,
  INVOICE_CURRENCY_CODES,
  INVOICE_CURRENCY_SYMBOLS,
  displayCurrency,
  type InvoiceCurrencyCode,
} from "./invoice-currency";
import type { InvoiceLineDTO } from "./invoicing.functions";

/*
 * Money as text (decision #69), identical on the web and in the apps: the
 * shared cases in docs/api/vectors/invoice-money.json are run by both.
 *
 * The amount is always the cents over 100 with two decimals and a dot, never
 * locale-formatted and never converted. A currency this build knows puts its
 * symbol directly before the amount ("$70.00", "£70.00"). One it does not know
 * (a currency added later) is written as its code and a space ("CHF 70.00"),
 * never as "$". A missing currency is US dollars, whose output for an amount
 * of zero or more is byte for byte what it was before invoices had a currency.
 *
 * A negative amount puts the minus sign first, before the symbol or the code
 * ("-$70.00", "-£62.50", "-CHF 70.00"), as the iOS app always has. The server
 * refuses negative amounts, so this is a rule for the ports to agree on and
 * not something a coach sees.
 */

/** A currency this build has a symbol for. */
function isKnownCurrency(currency: string): currency is InvoiceCurrencyCode {
  return (INVOICE_CURRENCY_CODES as readonly string[]).includes(currency);
}

/** What goes in front of the amount: the symbol, or the code and a space. */
function moneyPrefix(currency: string): string {
  return isKnownCurrency(currency) ? INVOICE_CURRENCY_SYMBOLS[currency] : `${currency} `;
}

/** "-" for an amount below zero, written before the symbol or the code. */
function moneySign(cents: number): string {
  return cents < 0 ? "-" : "";
}

/** "$70.00" / "£62.50" / "CHF 70.00"; below zero "-$70.00" / "-CHF 70.00". */
export function formatMoney(cents: number, currency?: string | null): string {
  const prefix = moneyPrefix(currency || DEFAULT_INVOICE_CURRENCY);
  return `${moneySign(cents)}${prefix}${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** "$70" / "$62.50": compact, for rate chips. */
export function formatMoneyShort(cents: number, currency?: string | null): string {
  return cents % 100 === 0
    ? `${moneySign(cents)}${moneyPrefix(currency || DEFAULT_INVOICE_CURRENCY)}${Math.abs(cents) / 100}`
    : formatMoney(cents, currency);
}

/** Parse a coach-typed dollar amount ("70", "$62.50") into cents. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** "Aug 4". `locale` is for tests and the shared vectors; screens use the browser's. */
export function formatShortDate(iso: string, locale?: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

export function formatDateRange(startIso: string, endIso: string, locale?: string): string {
  return `${formatShortDate(startIso, locale)} – ${formatShortDate(endIso, locale)}`;
}

/**
 * The invoice as plain text — this is the deliverable. It goes straight into
 * the native share sheet so it can be pasted into a text or a Venmo request.
 *
 * `currency` is the invoice's own when it has one, otherwise the coach's
 * (`invoiceShareText` chooses). Four currencies share "$", so the Total line
 * names the code after the amount whenever it is not US dollars
 * ("Total: $140.00 CAD"); a US dollar invoice reads exactly as it always has.
 * A code this build does not know is already written before the amount, so it
 * is not named a second time ("Total: CHF 140.00").
 */
export function buildInvoiceText(input: {
  athleteName: string;
  coachName?: string;
  periodStart: string;
  periodEnd: string;
  lines: InvoiceLineDTO[];
  totalCents: number;
  /** ISO 4217 code; missing is US dollars. */
  currency?: string | null;
  /** BCP 47 tag for the dates; the browser's when left out. */
  locale?: string;
}): string {
  const currency = input.currency || DEFAULT_INVOICE_CURRENCY;
  const header = [
    `Invoice — ${input.athleteName}`,
    formatDateRange(input.periodStart, input.periodEnd, input.locale),
    "",
  ];
  const body = input.lines.map(
    (l) =>
      `${formatShortDate(l.occurrenceDate, input.locale)}  ${formatMoney(l.amountCents, currency)}`,
  );
  const code =
    currency === DEFAULT_INVOICE_CURRENCY || !isKnownCurrency(currency) ? "" : ` ${currency}`;
  const footer = ["", `Total: ${formatMoney(input.totalCents, currency)}${code}`];
  if (input.coachName) footer.push(`— ${input.coachName}`);
  return [...header, ...body, ...footer].join("\n");
}

/**
 * The text a coach shares for an invoice that exists: from its detail screen,
 * or at the moment it is created. It is in the currency the invoice itself
 * carries (the one the database stamped on it), and in the coach's current one
 * only when the invoice carries none (a sample invoice, or one read before the
 * currency migration). The screen's copy of the coach's currency can be minutes
 * old, so it never decides for an invoice that has its own.
 */
export function invoiceShareText(
  invoice: {
    athleteName: string;
    periodStart: string;
    periodEnd: string;
    lines: InvoiceLineDTO[];
    totalCents: number;
    currency?: string | null;
  },
  coachCurrency: string | null | undefined,
  /** BCP 47 tag for the dates, for tests; the browser's when left out. */
  locale?: string,
): string {
  return buildInvoiceText({
    athleteName: invoice.athleteName,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    lines: invoice.lines,
    totalCents: invoice.totalCents,
    currency: displayCurrency(invoice.currency, coachCurrency),
    locale,
  });
}
