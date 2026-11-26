import { describe, expect, it } from "bun:test";
import { sanitizeReadOnlySql } from "./admin-ask.functions";
import { REPORTING_SCHEMA } from "./admin-ask-schema.server";

/*
 * Decision #69: invoices are no longer all in US dollars, so the schema the
 * admin Ask model writes its SQL from has to say so, or a question like "how
 * much was invoiced last month" adds pence to cents and answers one figure.
 */
describe("REPORTING_SCHEMA and invoice currency", () => {
  it("tells the model invoice amounts are per currency and must be grouped by it", () => {
    expect(REPORTING_SCHEMA).toContain("invoices.total_cents");
    expect(REPORTING_SCHEMA).toMatch(/never add[^\n]*across currencies/i);
    expect(REPORTING_SCHEMA).toMatch(/group by/i);
  });

  // Lovable applies migration 20261121120000 before or after this code is
  // deployed. A plain `invoices.currency` in the model's SQL would fail with
  // "column does not exist" until then; this expression reads NULL instead.
  it("reads the currency in a way that works before the migration too", () => {
    const expression = "coalesce(to_jsonb(i)->>'currency', 'USD')";
    expect(REPORTING_SCHEMA).toContain(expression);

    const invoicesLine = REPORTING_SCHEMA.split("\n").find((l) => l.startsWith("invoices("));
    expect(invoicesLine).toBeDefined();
    expect(invoicesLine).not.toMatch(/\bcurrency\b/);
    const coachLine = REPORTING_SCHEMA.split("\n").find((l) => l.startsWith("coach_profiles("));
    expect(coachLine).not.toMatch(/\binvoice_currency\b/);

    // And the read-only check lets a query that uses it through.
    const sql = `select ${expression} as currency, round(sum(i.total_cents) / 100.0, 1) as total from invoices i group by 1 order by 1 limit 200`;
    expect(sanitizeReadOnlySql(sql)).toBe(sql);
  });
});
