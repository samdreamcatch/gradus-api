/**
 * Writes docs/api/vectors/invoice-money.json: cases for `formatMoney`,
 * `formatMoneyShort` and `buildInvoiceText` (src/lib/invoice-format.ts) that
 * the native clients run against their ports, so an amount and a shared
 * invoice read the same on every platform (PRD §9.5 "Recurrence and formatting
 * parity", decision #69). `bun scripts/export-invoice-money-vectors.ts`;
 * src/lib/invoice-format.test.ts fails when the file drifts from the source.
 * `expected` is always regenerated from the TypeScript functions.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildInvoiceText, formatMoney, formatMoneyShort } from "../src/lib/invoice-format";

type MoneyInput = {
  function: "formatMoney" | "formatMoneyShort";
  cents: number;
  /** ISO 4217 code. Left out or null: US dollars. */
  currency?: string | null;
};

type InvoiceTextInput = {
  function: "buildInvoiceText";
  athleteName: string;
  coachName?: string;
  periodStart: string;
  periodEnd: string;
  lines: { occurrenceDate: string; amountCents: number }[];
  totalCents: number;
  currency?: string | null;
  /** The dates' locale, so `expected` is exact everywhere. */
  locale: string;
};

export type InvoiceMoneyInput = MoneyInput | InvoiceTextInput;

type Case = { name: string; input: InvoiceMoneyInput; expected: string };

/** The one implementation both the export and the test run a case through. */
export function runInvoiceMoneyCase(input: InvoiceMoneyInput): string {
  switch (input.function) {
    case "formatMoney":
      return formatMoney(input.cents, input.currency);
    case "formatMoneyShort":
      return formatMoneyShort(input.cents, input.currency);
    case "buildInvoiceText": {
      const { function: _function, ...invoice } = input;
      return buildInvoiceText(invoice);
    }
  }
}

const KNOWN = ["USD", "CAD", "AUD", "NZD", "GBP"] as const;

const august = {
  athleteName: "Maren Holloway",
  periodStart: "2026-08-03",
  periodEnd: "2026-08-17",
  lines: [
    { occurrenceDate: "2026-08-04", amountCents: 7000 },
    { occurrenceDate: "2026-08-11", amountCents: 7000 },
  ],
  totalCents: 14000,
  locale: "en-US",
};

const inputs: Array<{ name: string; input: InvoiceMoneyInput }> = [
  // formatMoney: always two decimals.
  ...KNOWN.map((currency) => ({
    name: `formatMoney: ${currency}, a whole amount keeps its two decimals`,
    input: { function: "formatMoney" as const, cents: 7000, currency },
  })),
  ...KNOWN.map((currency) => ({
    name: `formatMoney: ${currency}, a fractional amount`,
    input: { function: "formatMoney" as const, cents: 6250, currency },
  })),
  {
    name: "formatMoney: no currency is US dollars",
    input: { function: "formatMoney", cents: 7000 },
  },
  {
    name: "formatMoney: a null currency is US dollars",
    input: { function: "formatMoney", cents: 6250, currency: null },
  },
  {
    name: "formatMoney: an unknown code is the code and a space, never a dollar sign",
    input: { function: "formatMoney", cents: 7000, currency: "CHF" },
  },
  {
    name: "formatMoney: an unknown code, a fractional amount",
    input: { function: "formatMoney", cents: 6250, currency: "CHF" },
  },
  {
    name: "formatMoney: zero",
    input: { function: "formatMoney", cents: 0, currency: "GBP" },
  },
  {
    name: "formatMoney: under one unit",
    input: { function: "formatMoney", cents: 5, currency: "USD" },
  },
  {
    name: "formatMoney: thousands are not grouped",
    input: { function: "formatMoney", cents: 123456, currency: "GBP" },
  },
  {
    name: "formatMoney: the largest amount the server accepts",
    input: { function: "formatMoney", cents: 10_000_000, currency: "USD" },
  },
  {
    name: "formatMoney: negative, the minus sign comes before the symbol",
    input: { function: "formatMoney", cents: -7000, currency: "USD" },
  },
  {
    name: "formatMoney: negative and fractional in pounds",
    input: { function: "formatMoney", cents: -6250, currency: "GBP" },
  },
  {
    name: "formatMoney: negative under one unit",
    input: { function: "formatMoney", cents: -5, currency: "CAD" },
  },
  {
    name: "formatMoney: negative with an unknown code, the minus sign before the code",
    input: { function: "formatMoney", cents: -7000, currency: "CHF" },
  },

  // formatMoneyShort: a whole amount drops its decimals.
  ...KNOWN.map((currency) => ({
    name: `formatMoneyShort: ${currency}, a whole amount has no decimals`,
    input: { function: "formatMoneyShort" as const, cents: 7000, currency },
  })),
  ...KNOWN.map((currency) => ({
    name: `formatMoneyShort: ${currency}, a fractional amount keeps two decimals`,
    input: { function: "formatMoneyShort" as const, cents: 6250, currency },
  })),
  {
    name: "formatMoneyShort: no currency is US dollars",
    input: { function: "formatMoneyShort", cents: 7000 },
  },
  {
    name: "formatMoneyShort: an unknown code, a whole amount",
    input: { function: "formatMoneyShort", cents: 7000, currency: "CHF" },
  },
  {
    name: "formatMoneyShort: an unknown code, a fractional amount",
    input: { function: "formatMoneyShort", cents: 6250, currency: "CHF" },
  },
  {
    name: "formatMoneyShort: zero",
    input: { function: "formatMoneyShort", cents: 0, currency: "USD" },
  },
  {
    name: "formatMoneyShort: fifty cents over keeps two decimals",
    input: { function: "formatMoneyShort", cents: 7050, currency: "GBP" },
  },
  {
    name: "formatMoneyShort: negative and whole",
    input: { function: "formatMoneyShort", cents: -7000, currency: "GBP" },
  },
  {
    name: "formatMoneyShort: negative and fractional",
    input: { function: "formatMoneyShort", cents: -6250, currency: "USD" },
  },
  {
    name: "formatMoneyShort: negative and whole with an unknown code",
    input: { function: "formatMoneyShort", cents: -7000, currency: "CHF" },
  },

  // buildInvoiceText: the text a coach shares with a family.
  {
    name: "buildInvoiceText: US dollars, the text as it was before invoices had a currency",
    input: {
      function: "buildInvoiceText",
      ...august,
      coachName: "Thea Solberg",
      lines: [
        { occurrenceDate: "2026-08-04", amountCents: 7000 },
        { occurrenceDate: "2026-08-11", amountCents: 6250 },
      ],
      totalCents: 13250,
      currency: "USD",
    },
  },
  {
    name: "buildInvoiceText: no currency and no coach name is the same US dollar text without a signature",
    input: {
      function: "buildInvoiceText",
      athleteName: "Maren Holloway",
      periodStart: "2026-12-28",
      periodEnd: "2027-01-04",
      lines: [{ occurrenceDate: "2026-12-29", amountCents: 7000 }],
      totalCents: 7000,
      locale: "en-US",
    },
  },
  {
    name: "buildInvoiceText: Canadian dollars, the Total line names the code because the symbol is shared",
    input: { function: "buildInvoiceText", ...august, coachName: "Thea Solberg", currency: "CAD" },
  },
  {
    name: "buildInvoiceText: pounds, the symbol on every amount and the code on the Total line",
    input: { function: "buildInvoiceText", ...august, coachName: "Thea Solberg", currency: "GBP" },
  },
  {
    name: "buildInvoiceText: an unknown code before every amount, and not a second time after the total",
    input: { function: "buildInvoiceText", ...august, currency: "CHF" },
  },
  {
    name: "buildInvoiceText: no lines",
    input: { function: "buildInvoiceText", ...august, lines: [], totalCents: 0, currency: "NZD" },
  },
];

export const INVOICE_MONEY_VECTOR = {
  description:
    'Invoice money as text (decision #69). Every case names its function in input.function. formatMoney: the currency\'s prefix, then cents / 100 with exactly two decimals and a dot, no grouping, never locale-formatted. The prefix is the symbol for the five known codes (USD, CAD, AUD and NZD "$", GBP "£") and, for any other code, the code itself and one space; codes are compared exactly as stored, in upper case. A currency that is left out or null is USD. A negative amount puts the minus sign first, before the symbol or the code, and then reads as the positive amount does ("-$70.00", "-£62.50", "-CHF 70.00"); zero is never signed. formatMoneyShort: the same, except an amount that is a whole number of units has no decimals ("$70", "-$70"). buildInvoiceText: the plain text a coach shares: "Invoice — {athleteName}" (an em dash), the period as "{start} – {end}" (an en dash), an empty line, one line per invoice line as "{date}  {formatMoney}" (two spaces), an empty line, "Total: {formatMoney}" followed by a space and the code only when the currency is one of the five known codes and is not USD (an unknown code is already written before the amount, so it is not repeated: "Total: CHF 140.00"), then "— {coachName}" when there is one; lines are joined with "\\n". Dates are calendar dates with no time zone, written as short month and day in input.locale ("Aug 4" in en-US). These cases are ordinary private lessons: the apps add a note after the amount on a group lesson\'s line and on a billed cancellation\'s (decision #68), which the web\'s text does not have and no case here covers.',
  source: "src/lib/invoice-format.ts",
  cases: inputs.map(
    ({ name, input }): Case => ({ name, input, expected: runInvoiceMoneyCase(input) }),
  ),
};

if (import.meta.main) {
  const out = fileURLToPath(new URL("../docs/api/vectors/invoice-money.json", import.meta.url));
  writeFileSync(out, `${JSON.stringify(INVOICE_MONEY_VECTOR, null, 2)}\n`);
  console.log(`Wrote ${out}`);
}
