import { describe, expect, it } from "bun:test";
import {
  DEFAULT_INVOICE_CURRENCY,
  INVOICE_CURRENCY_CODES,
  INVOICE_CURRENCY_SYMBOLS,
  displayCurrency,
} from "./invoice-currency";

describe("invoice currencies", () => {
  it("has a symbol for every code a coach can pick, and no others", () => {
    expect(Object.keys(INVOICE_CURRENCY_SYMBOLS).sort()).toEqual(
      [...INVOICE_CURRENCY_CODES].sort(),
    );
    expect(INVOICE_CURRENCY_SYMBOLS.GBP).toBe("£");
    for (const code of ["USD", "CAD", "AUD", "NZD"] as const) {
      expect(INVOICE_CURRENCY_SYMBOLS[code]).toBe("$");
    }
    expect(DEFAULT_INVOICE_CURRENCY).toBe("USD");
  });
});

describe("displayCurrency", () => {
  it("is the invoice's own currency when it has one", () => {
    expect(displayCurrency("GBP", "USD")).toBe("GBP");
    expect(displayCurrency("USD", "GBP")).toBe("USD");
    // A currency added by a later server passes through as it is.
    expect(displayCurrency("CHF", "GBP")).toBe("CHF");
  });

  it("is the coach's when the invoice carries none", () => {
    expect(displayCurrency(undefined, "GBP")).toBe("GBP");
    expect(displayCurrency(null, "CAD")).toBe("CAD");
    expect(displayCurrency("", "CAD")).toBe("CAD");
  });

  it("is US dollars when neither is known", () => {
    expect(displayCurrency(undefined, undefined)).toBe("USD");
    expect(displayCurrency(null, null)).toBe("USD");
  });
});
