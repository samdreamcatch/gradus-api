import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  INVOICE_MONEY_VECTOR,
  runInvoiceMoneyCase,
  type InvoiceMoneyInput,
} from "../../scripts/export-invoice-money-vectors";
import {
  buildInvoiceText,
  formatDateRange,
  formatMoney,
  formatMoneyShort,
  formatShortDate,
  invoiceShareText,
  parseMoneyToCents,
} from "./invoice-format";

/*
 * US dollar output, pinned as it was before invoices had a currency (decision
 * #69). These expectations were written against the earlier, dollar-only
 * functions and must never change: a US dollar coach's amounts and shared
 * invoice text stay byte for byte what they were. The one exception is an
 * amount below zero, which no coach can reach (the server refuses it): the
 * web wrote "$-70.00" and now writes "-$70.00", as the iOS app always has.
 */
describe("invoice money, US dollars", () => {
  it("formats cents with two decimals and no grouping", () => {
    expect(formatMoney(7000)).toBe("$70.00");
    expect(formatMoney(6250)).toBe("$62.50");
    expect(formatMoney(5)).toBe("$0.05");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(123456)).toBe("$1234.56");
    expect(formatMoney(10_000_000)).toBe("$100000.00");
  });

  it("puts the minus sign before the symbol for a negative amount", () => {
    expect(formatMoney(-7000)).toBe("-$70.00");
    expect(formatMoney(-5)).toBe("-$0.05");
    expect(formatMoney(-1)).toBe("-$0.01");
    expect(formatMoney(-123456)).toBe("-$1234.56");
    // Zero is never signed, however it was reached.
    expect(formatMoney(-0)).toBe("$0.00");
    expect(formatMoneyShort(-0)).toBe("$0");
  });

  it("drops the cents from a whole amount in the short form only", () => {
    expect(formatMoneyShort(7000)).toBe("$70");
    expect(formatMoneyShort(0)).toBe("$0");
    expect(formatMoneyShort(6250)).toBe("$62.50");
    expect(formatMoneyShort(7005)).toBe("$70.05");
    expect(formatMoneyShort(-7000)).toBe("-$70");
    expect(formatMoneyShort(-6250)).toBe("-$62.50");
  });

  it("builds the shared invoice text", () => {
    expect(
      buildInvoiceText({
        athleteName: "Maren Holloway",
        coachName: "Thea Solberg",
        periodStart: "2026-08-03",
        periodEnd: "2026-08-17",
        lines: [
          { occurrenceDate: "2026-08-04", amountCents: 7000 },
          { occurrenceDate: "2026-08-11", amountCents: 6250 },
        ],
        totalCents: 13250,
      }),
    ).toBe(
      [
        "Invoice — Maren Holloway",
        "Aug 3 – Aug 17",
        "",
        "Aug 4  $70.00",
        "Aug 11  $62.50",
        "",
        "Total: $132.50",
        "— Thea Solberg",
      ].join("\n"),
    );
  });

  it("leaves the signature out when there is no coach name", () => {
    expect(
      buildInvoiceText({
        athleteName: "Maren Holloway",
        periodStart: "2026-12-28",
        periodEnd: "2027-01-04",
        lines: [{ occurrenceDate: "2026-12-29", amountCents: 7000 }],
        totalCents: 7000,
      }),
    ).toBe(
      [
        "Invoice — Maren Holloway",
        "Dec 28 – Jan 4",
        "",
        "Dec 29  $70.00",
        "",
        "Total: $70.00",
      ].join("\n"),
    );
  });

  it("builds an invoice with no lines", () => {
    expect(
      buildInvoiceText({
        athleteName: "Maren Holloway",
        periodStart: "2026-08-03",
        periodEnd: "2026-08-17",
        lines: [],
        totalCents: 0,
      }),
    ).toBe(["Invoice — Maren Holloway", "Aug 3 – Aug 17", "", "", "Total: $0.00"].join("\n"));
  });
});

describe("invoice dates", () => {
  it("formats a calendar date and a range", () => {
    expect(formatShortDate("2026-08-04")).toBe("Aug 4");
    expect(formatDateRange("2026-08-03", "2026-08-17")).toBe("Aug 3 – Aug 17");
  });
});

describe("parseMoneyToCents", () => {
  it("reads a typed amount, with or without a dollar sign", () => {
    expect(parseMoneyToCents("70")).toBe(7000);
    expect(parseMoneyToCents("$62.50")).toBe(6250);
    expect(parseMoneyToCents(" 30.5 ")).toBe(3050);
    expect(parseMoneyToCents("0")).toBe(0);
  });

  it("answers null when there is no amount", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("1.2.3")).toBeNull();
  });
});

/* Decision #69: one invoice currency per coach. */
describe("invoice money in a currency", () => {
  it("writes the symbol directly before the amount for the five known codes", () => {
    expect(formatMoney(7000, "USD")).toBe("$70.00");
    expect(formatMoney(7000, "CAD")).toBe("$70.00");
    expect(formatMoney(7000, "AUD")).toBe("$70.00");
    expect(formatMoney(7000, "NZD")).toBe("$70.00");
    expect(formatMoney(7000, "GBP")).toBe("£70.00");
    expect(formatMoney(6250, "GBP")).toBe("£62.50");
    expect(formatMoney(-7000, "GBP")).toBe("-£70.00");
    expect(formatMoney(-6250, "GBP")).toBe("-£62.50");
    expect(formatMoney(-7000, "CAD")).toBe("-$70.00");

    expect(formatMoneyShort(7000, "GBP")).toBe("£70");
    expect(formatMoneyShort(6250, "GBP")).toBe("£62.50");
    expect(formatMoneyShort(7000, "NZD")).toBe("$70");
    expect(formatMoneyShort(-7000, "GBP")).toBe("-£70");
    expect(formatMoneyShort(-6250, "GBP")).toBe("-£62.50");
  });

  it("writes a code it does not know as the code and a space, never as a dollar sign", () => {
    expect(formatMoney(7000, "CHF")).toBe("CHF 70.00");
    // Below zero the minus sign still comes first, before the code.
    expect(formatMoney(-7000, "CHF")).toBe("-CHF 70.00");
    expect(formatMoney(-6250, "CHF")).toBe("-CHF 62.50");
    expect(formatMoneyShort(-7000, "CHF")).toBe("-CHF 70");
    expect(formatMoneyShort(-6250, "CHF")).toBe("-CHF 62.50");
    expect(formatMoneyShort(7000, "CHF")).toBe("CHF 70");
    expect(formatMoneyShort(6250, "CHF")).toBe("CHF 62.50");
    // A name every object inherits is still an unknown code.
    expect(formatMoney(7000, "constructor")).toBe("constructor 70.00");
  });

  it("reads a missing currency as US dollars", () => {
    expect(formatMoney(7000, undefined)).toBe("$70.00");
    expect(formatMoney(7000, null)).toBe("$70.00");
    expect(formatMoney(7000, "")).toBe("$70.00");
    expect(formatMoneyShort(7000, null)).toBe("$70");
  });
});

describe("invoice text in a currency", () => {
  const invoice = {
    athleteName: "Maren Holloway",
    coachName: "Thea Solberg",
    periodStart: "2026-08-03",
    periodEnd: "2026-08-17",
    lines: [
      { occurrenceDate: "2026-08-04", amountCents: 7000 },
      { occurrenceDate: "2026-08-11", amountCents: 7000 },
    ],
    totalCents: 14000,
    locale: "en-US",
  };
  const text = (lines: string[]) => lines.join("\n");

  it("names the code on the Total line when the symbol is shared", () => {
    expect(buildInvoiceText({ ...invoice, currency: "CAD" })).toBe(
      text([
        "Invoice — Maren Holloway",
        "Aug 3 – Aug 17",
        "",
        "Aug 4  $70.00",
        "Aug 11  $70.00",
        "",
        "Total: $140.00 CAD",
        "— Thea Solberg",
      ]),
    );
  });

  it("uses the pound sign on every amount and names the code on the Total line", () => {
    expect(buildInvoiceText({ ...invoice, currency: "GBP" })).toBe(
      text([
        "Invoice — Maren Holloway",
        "Aug 3 – Aug 17",
        "",
        "Aug 4  £70.00",
        "Aug 11  £70.00",
        "",
        "Total: £140.00 GBP",
        "— Thea Solberg",
      ]),
    );
  });

  it("leaves a US dollar invoice exactly as it was, named or not", () => {
    const usd = text([
      "Invoice — Maren Holloway",
      "Aug 3 – Aug 17",
      "",
      "Aug 4  $70.00",
      "Aug 11  $70.00",
      "",
      "Total: $140.00",
      "— Thea Solberg",
    ]);
    expect(buildInvoiceText({ ...invoice, currency: "USD" })).toBe(usd);
    expect(buildInvoiceText({ ...invoice, currency: null })).toBe(usd);
    expect(buildInvoiceText({ ...invoice, currency: undefined })).toBe(usd);
  });

  it("writes an unknown code before each amount, and does not name it a second time after the total", () => {
    expect(buildInvoiceText({ ...invoice, coachName: undefined, currency: "CHF" })).toBe(
      text([
        "Invoice — Maren Holloway",
        "Aug 3 – Aug 17",
        "",
        "Aug 4  CHF 70.00",
        "Aug 11  CHF 70.00",
        "",
        "Total: CHF 140.00",
      ]),
    );
  });

  it("formats the dates in the locale it is given", () => {
    expect(formatShortDate("2026-08-04", "en-GB")).toBe("4 Aug");
    expect(buildInvoiceText({ ...invoice, locale: "en-GB", currency: "GBP" })).toContain(
      "3 Aug – 17 Aug\n\n4 Aug  £70.00",
    );
  });
});

/*
 * What the two coach screens share: the invoice's detail (Share invoice) and
 * the invoice just created (Create & share). Both go through this one
 * function, so neither can build the text in a currency other than the
 * invoice's own.
 */
describe("the text shared for an invoice", () => {
  const invoice = {
    athleteName: "Maren Holloway",
    periodStart: "2026-08-03",
    periodEnd: "2026-08-17",
    lines: [
      { occurrenceDate: "2026-08-04", amountCents: 7000 },
      { occurrenceDate: "2026-08-11", amountCents: 6250 },
    ],
    totalCents: 13250,
  };
  const inPounds =
    "Invoice — Maren Holloway\nAug 3 – Aug 17\n\nAug 4  £70.00\nAug 11  £62.50\n\nTotal: £132.50 GBP";
  const inDollars =
    "Invoice — Maren Holloway\nAug 3 – Aug 17\n\nAug 4  $70.00\nAug 11  $62.50\n\nTotal: $132.50";

  it("is in the invoice's own currency, whatever the coach's is on this screen", () => {
    // Created in pounds; the screen's copy of the coach's currency is older, or unknown.
    expect(invoiceShareText({ ...invoice, currency: "GBP" }, "USD", "en-US")).toBe(inPounds);
    expect(invoiceShareText({ ...invoice, currency: "GBP" }, undefined, "en-US")).toBe(inPounds);
    // Created in dollars before the coach switched to pounds.
    expect(invoiceShareText({ ...invoice, currency: "USD" }, "GBP", "en-US")).toBe(inDollars);
  });

  it("falls back to the coach's currency for an invoice that carries none", () => {
    expect(invoiceShareText(invoice, "GBP", "en-US")).toBe(inPounds);
    expect(invoiceShareText({ ...invoice, currency: null }, "GBP", "en-US")).toBe(inPounds);
  });

  it("is US dollars when neither is known", () => {
    expect(invoiceShareText(invoice, undefined, "en-US")).toBe(inDollars);
    expect(invoiceShareText(invoice, null, "en-US")).toBe(inDollars);
  });

  it("uses only the invoice's own fields: a detail row's other fields change nothing", () => {
    const detail = { ...invoice, id: "inv-1", status: "unpaid", lineCount: 2, currency: "GBP" };
    expect(invoiceShareText(detail, "USD", "en-US")).toBe(inPounds);
  });
});

describe("invoice money contract vector", () => {
  const file = fileURLToPath(new URL("../../docs/api/vectors/invoice-money.json", import.meta.url));
  const onDisk = JSON.parse(readFileSync(file, "utf8")) as {
    cases: { name: string; input: InvoiceMoneyInput; expected: string }[];
  };

  it("matches the source (run `bun scripts/export-invoice-money-vectors.ts` after editing the cases or the functions)", () => {
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(INVOICE_MONEY_VECTOR)));
  });

  it("produces every expected value from the file the apps run", () => {
    expect(onDisk.cases.length).toBeGreaterThan(30);
    for (const { name, input, expected } of onDisk.cases) {
      expect({ name, text: runInvoiceMoneyCase(input) }).toEqual({ name, text: expected });
    }
  });

  it("covers every currency a coach can pick, an unknown one, and a missing one", () => {
    const currenciesOf = (fn: InvoiceMoneyInput["function"]) =>
      onDisk.cases.filter((c) => c.input.function === fn).map((c) => c.input.currency ?? "(none)");
    for (const fn of ["formatMoney", "formatMoneyShort"] as const) {
      for (const code of ["USD", "CAD", "AUD", "NZD", "GBP", "CHF", "(none)"]) {
        expect(currenciesOf(fn)).toContain(code);
      }
    }
    for (const code of ["USD", "CAD", "GBP", "CHF", "(none)"]) {
      expect(currenciesOf("buildInvoiceText")).toContain(code);
    }
  });

  it("pins what the vectors document", () => {
    const expected = (name: string) => onDisk.cases.find((c) => c.name === name)?.expected;
    expect(expected("formatMoney: GBP, a fractional amount")).toBe("£62.50");
    expect(
      expected("formatMoney: an unknown code is the code and a space, never a dollar sign"),
    ).toBe("CHF 70.00");
    expect(expected("formatMoney: negative, the minus sign comes before the symbol")).toBe(
      "-$70.00",
    );
    expect(expected("formatMoney: negative and fractional in pounds")).toBe("-£62.50");
    expect(
      expected("formatMoney: negative with an unknown code, the minus sign before the code"),
    ).toBe("-CHF 70.00");
    expect(expected("formatMoneyShort: negative and whole")).toBe("-£70");
    expect(expected("formatMoneyShort: GBP, a whole amount has no decimals")).toBe("£70");
    expect(
      expected("buildInvoiceText: US dollars, the text as it was before invoices had a currency"),
    ).toBe(
      "Invoice — Maren Holloway\nAug 3 – Aug 17\n\nAug 4  $70.00\nAug 11  $62.50\n\nTotal: $132.50\n— Thea Solberg",
    );
    expect(
      expected(
        "buildInvoiceText: Canadian dollars, the Total line names the code because the symbol is shared",
      ),
    ).toBe(
      "Invoice — Maren Holloway\nAug 3 – Aug 17\n\nAug 4  $70.00\nAug 11  $70.00\n\nTotal: $140.00 CAD\n— Thea Solberg",
    );
  });
});
