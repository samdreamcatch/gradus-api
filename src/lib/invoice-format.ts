import type { InvoiceLineDTO } from "./invoicing.functions";

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "$70" / "$62.50" — compact, for rate chips. */
export function formatMoneyShort(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : formatMoney(cents);
}

/** Parse a coach-typed dollar amount ("70", "$62.50") into cents. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatDateRange(startIso: string, endIso: string): string {
  return `${formatShortDate(startIso)} – ${formatShortDate(endIso)}`;
}

/**
 * The invoice as plain text — this is the deliverable. It goes straight into
 * the native share sheet so it can be pasted into a text or a Venmo request.
 */
export function buildInvoiceText(input: {
  athleteName: string;
  coachName?: string;
  periodStart: string;
  periodEnd: string;
  lines: InvoiceLineDTO[];
  totalCents: number;
}): string {
  const header = [
    `Invoice — ${input.athleteName}`,
    formatDateRange(input.periodStart, input.periodEnd),
    "",
  ];
  const body = input.lines.map(
    (l) => `${formatShortDate(l.occurrenceDate)}  ${formatMoney(l.amountCents)}`,
  );
  const footer = ["", `Total: ${formatMoney(input.totalCents)}`];
  if (input.coachName) footer.push(`— ${input.coachName}`);
  return [...header, ...body, ...footer].join("\n");
}
