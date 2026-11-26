import type { ReactElement } from "react";
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sheet } from "@/components/ui/sheet";
import { invoiceCurrencyQueryOptions } from "@/hooks/use-invoice-currency";
import type { AthleteBillingDTO, InvoiceDTO, InvoicePreviewDTO } from "@/lib/invoicing.functions";
import { AthleteBillingSection } from "./athlete-billing-section";
import { AthleteDetailBody } from "./athlete-detail-sheet";
import { BillingTab } from "./billing-tab";
import { InvoiceDetailBody } from "./invoice-detail-sheet";
import { InvoiceGenerateBody } from "./invoice-generate-sheet";

/*
 * Decision #69 on the coach's web invoicing screens: an invoice is shown in
 * the currency it was created in, and everything without a currency of its own
 * (a rate, a draft, an older invoice) in the coach's. Each screen is rendered
 * once from a seeded query cache, so nothing here reaches a server.
 */

const ATHLETE_ID = "11111111-1111-4111-8111-111111111111";

function invoice(overrides: Partial<InvoiceDTO>): InvoiceDTO {
  return {
    id: "inv-1",
    athleteId: ATHLETE_ID,
    athleteName: "Alex One",
    periodStart: "2026-08-03",
    periodEnd: "2026-08-17",
    totalCents: 14000,
    status: "unpaid",
    createdAt: "2026-08-18T00:00:00Z",
    lineCount: 2,
    ...overrides,
  };
}

/** A cache holding the coach's currency (`undefined`: not loaded yet). */
function cacheWith(coachCurrency: string | null | undefined): QueryClient {
  const client = new QueryClient();
  if (coachCurrency !== undefined) {
    client.setQueryData(invoiceCurrencyQueryOptions.queryKey, { invoiceCurrency: coachCurrency });
  }
  return client;
}

/** A cache in which the read of the coach's currency has failed (after its retry). */
async function cacheWithFailedRead(): Promise<QueryClient> {
  const client = new QueryClient();
  await client
    .fetchQuery({
      ...invoiceCurrencyQueryOptions,
      queryFn: () => Promise.reject(new Error("Couldn't load your invoice currency.")),
      retry: false,
    })
    .catch(() => {});
  expect(client.getQueryState(invoiceCurrencyQueryOptions.queryKey)?.status).toBe("error");
  return client;
}

function render(client: QueryClient, ui: ReactElement): string {
  return renderToStaticMarkup(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

describe("BillingTab", () => {
  const rows = [
    invoice({ id: "inv-gbp", athleteName: "Alex One", totalCents: 14000, currency: "GBP" }),
    invoice({ id: "inv-chf", athleteName: "Bailey Two", totalCents: 9000, currency: "CHF" }),
    invoice({ id: "inv-none", athleteName: "Alex One", totalCents: 6250 }),
  ];

  it("shows each invoice in the currency it was created in, whatever the coach's is now", () => {
    const client = cacheWith("USD");
    client.setQueryData(["coach", "invoices"], rows);
    const html = render(client, <BillingTab athletes={[]} />);
    expect(html).toContain("£140.00");
    // A code this build does not know is never shown as dollars.
    expect(html).toContain("CHF 90.00");
    expect(html).not.toContain("$90.00");
    expect(html).toContain("$62.50");
  });

  it("shows an invoice that carries no currency in the coach's", () => {
    const client = cacheWith("GBP");
    client.setQueryData(["coach", "invoices"], rows);
    const html = render(client, <BillingTab athletes={[]} />);
    expect(html).toContain("£62.50");
    expect(html).not.toContain("$");
  });

  it("reads an unknown coach currency as US dollars", () => {
    const client = cacheWith(null);
    client.setQueryData(["coach", "invoices"], [invoice({ totalCents: 6250 })]);
    expect(render(client, <BillingTab athletes={[]} />)).toContain("$62.50");
  });
});

describe("AthleteBillingSection", () => {
  const billing: AthleteBillingDTO = {
    athleteId: ATHLETE_ID,
    athleteName: "Alex One",
    rate: { rateKind: "per_session", rateCents: 7000 },
    invoices: [
      invoice({ id: "inv-usd", totalCents: 14000, currency: "USD" }),
      invoice({ id: "inv-none", totalCents: 6250 }),
    ],
  };

  function seeded(coachCurrency: string | null | undefined): QueryClient {
    const client = cacheWith(coachCurrency);
    client.setQueryData(["coach", "billing", ATHLETE_ID], billing);
    return client;
  }

  it("shows the rate in the coach's currency and each invoice in its own", () => {
    const html = render(seeded("GBP"), <AthleteBillingSection athleteId={ATHLETE_ID} />);
    expect(html).toContain("£70 per session");
    // Created in US dollars before the coach switched: still dollars.
    expect(html).toContain("$140.00");
    expect(html).toContain("£62.50");
  });

  it("is unchanged for a US dollar coach", () => {
    const html = render(seeded("USD"), <AthleteBillingSection athleteId={ATHLETE_ID} />);
    expect(html).toContain("$70 per session");
    expect(html).toContain("$140.00");
    expect(html).toContain("$62.50");
  });

  it("waits for the coach's currency instead of showing a dollar sign first", () => {
    const html = render(seeded(undefined), <AthleteBillingSection athleteId={ATHLETE_ID} />);
    expect(html).toContain("Loading invoicing");
    expect(html).not.toContain("$");
  });

  // A screen that mounts after the read failed starts it again; the section
  // must not drop back to its spinner for that, or it would close a sheet the
  // coach just opened, whose body starts the read again, for as long as it fails.
  it("stays on screen in US dollars after the currency read failed, while it is read again", async () => {
    const client = await cacheWithFailedRead();
    client.setQueryData(["coach", "billing", ATHLETE_ID], billing);
    const html = render(client, <AthleteBillingSection athleteId={ATHLETE_ID} />);
    expect(html).not.toContain("Loading invoicing");
    expect(html).toContain("$70 per session");
    expect(html).toContain("Generate invoice");
  });
});

describe("AthleteDetailBody", () => {
  // The Invoicing section waits for the coach's currency, and mounts only once
  // the athlete's detail has arrived: left to the section, the read would start
  // then, one round trip late.
  it("starts the currency read with the athlete's detail, not after it", () => {
    const client = new QueryClient();
    const html = render(client, <AthleteDetailBody athleteId={ATHLETE_ID} />);
    // Still waiting for the detail, so the Invoicing section is not mounted.
    expect(html).not.toContain("Invoicing");
    const cache = client.getQueryCache();
    expect(cache.find({ queryKey: ["coach", "billing", ATHLETE_ID] })).toBeDefined();
    expect(cache.find({ queryKey: invoiceCurrencyQueryOptions.queryKey })).toBeDefined();
  });
});

describe("InvoiceDetailBody", () => {
  const detail = {
    ...invoice({ id: "inv-9", totalCents: 13250 }),
    lines: [
      { occurrenceDate: "2026-08-04", amountCents: 7000 },
      { occurrenceDate: "2026-08-11", amountCents: 6250 },
    ],
  };

  function html(coachCurrency: string | null, currency?: string): string {
    const client = cacheWith(coachCurrency);
    client.setQueryData(["coach", "invoice", "inv-9"], { ...detail, currency });
    return render(
      client,
      <Sheet open>
        <InvoiceDetailBody invoiceId="inv-9" onClose={() => {}} />
      </Sheet>,
    );
  }

  it("shows the lines and the total in the invoice's own currency", () => {
    const out = html("USD", "GBP");
    expect(out).toContain("£70.00");
    expect(out).toContain("£62.50");
    expect(out).toContain("£132.50");
    expect(out).not.toContain("$");
  });

  it("falls back to the coach's currency, then to US dollars", () => {
    expect(html("GBP")).toContain("£132.50");
    const usd = html(null);
    expect(usd).toContain("$70.00");
    expect(usd).toContain("$132.50");
  });
});

describe("InvoiceGenerateBody", () => {
  const draft: InvoicePreviewDTO = {
    athleteId: ATHLETE_ID,
    athleteName: "Alex One",
    rate: null,
    suggestedPeriodStart: null,
    periodStart: "2026-08-03",
    periodEnd: "2026-08-17",
    lines: [],
  };

  function html(coachCurrency: string | null | undefined): string {
    const client = cacheWith(coachCurrency);
    client.setQueryData(["coach", "invoice-preview", ATHLETE_ID, null, todayIso()], draft);
    return render(
      client,
      <Sheet open>
        <InvoiceGenerateBody athleteId={ATHLETE_ID} onDone={() => {}} />
      </Sheet>,
    );
  }

  it("asks for an amount without naming a currency", () => {
    const out = html("GBP");
    expect(out).toContain("Amount");
    expect(out).not.toContain("USD");
  });

  it("shows the draft total in the coach's currency", () => {
    expect(html("GBP")).toContain("£0.00");
    expect(html("CAD")).toContain("$0.00");
    expect(html(null)).toContain("$0.00");
  });

  it("waits for the coach's currency before showing the draft", () => {
    const out = html(undefined);
    expect(out).not.toContain("Alex One");
    expect(out).not.toContain("$");
  });

  it("shows the draft in US dollars after the currency read failed, while it is read again", async () => {
    const client = await cacheWithFailedRead();
    client.setQueryData(["coach", "invoice-preview", ATHLETE_ID, null, todayIso()], draft);
    const out = render(
      client,
      <Sheet open>
        <InvoiceGenerateBody athleteId={ATHLETE_ID} onDone={() => {}} />
      </Sheet>,
    );
    expect(out).toContain("$0.00");
  });
});
