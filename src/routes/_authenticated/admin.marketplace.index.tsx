import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { adminMarketplaceOverview } from "@/lib/admin-marketplace.functions";
import { chipClasses } from "@/components/ui/chip";
import {
  AdminPageHeader,
  EmptyRow,
  Kpi,
  Panel,
  Section,
  Stars,
  money,
} from "@/components/admin/marketplace-ui";

const WINDOWS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 0, label: "All time" },
] as const;

const searchSchema = z.object({
  days: fallback(z.number(), 30).default(30),
  test: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/admin/marketplace/")({
  validateSearch: zodValidator(searchSchema),
  component: MarketplaceOverview,
});

function MarketplaceOverview() {
  const { days, test } = Route.useSearch();
  const overviewFn = useServerFn(adminMarketplaceOverview);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-marketplace-overview", days, test],
    queryFn: () => overviewFn({ data: { days: days || null, includeTest: test } }),
  });
  const windowLabel = WINDOWS.find((w) => w.value === days)?.label ?? `${days} days`;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-10">
      <AdminPageHeader
        title="Marketplace"
        subtitle="Sales, revenue, sellers, held earnings, promo codes, top plans, and flags."
      >
        <div className="flex flex-wrap gap-2">
          {WINDOWS.map((w) => (
            <Link
              key={w.value}
              from={Route.fullPath}
              search={(prev: any) => ({ ...prev, days: w.value })}
              className={chipClasses({
                tone: "muted",
                weight: "medium",
                selected: days === w.value,
              })}
            >
              {w.label}
            </Link>
          ))}
        </div>
      </AdminPageHeader>

      {isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : error || !data ? (
        <p className="text-sm text-destructive">
          Couldn't load the marketplace report. {error instanceof Error ? error.message : ""}
        </p>
      ) : (
        <>
          <Section title={`Sales · ${windowLabel}`}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              <Kpi
                label="Sales"
                value={data.sales.sales}
                sub={`${data.sales.freeClaims} free claims`}
                to="/admin/marketplace/purchases"
                search={{ test }}
              />
              <Kpi label="Gross sales" value={money(data.sales.grossCents)} />
              <Kpi
                label="Platform revenue"
                value={money(data.sales.platformFeeCents)}
                sub="Gradus 3% fee"
              />
              <Kpi label="Coach payouts" value={money(data.sales.coachPayoutCents)} />
              <Kpi label="Stripe fees" value={money(data.sales.stripeFeeCents)} />
              <Kpi label="Promo discounts" value={money(data.sales.discountCents)} />
              <Kpi
                label="Sellers with sales"
                value={data.sellersWithSales}
                to="/admin/marketplace/sellers"
                search={{ test }}
              />
              <Kpi
                label="All-time gross"
                value={money(data.allTimeSales.grossCents)}
                sub={`${data.allTimeSales.sales} sales · ${money(data.allTimeSales.platformFeeCents)} to Gradus`}
              />
            </div>
          </Section>

          <Section title="Marketplace now">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              <Kpi
                label="Active sellers"
                value={data.activeSellers}
                sub="Coach Pro with a live listing"
                to="/admin/marketplace/sellers"
                search={{ test }}
              />
              <Kpi
                label="Live listings"
                value={data.liveListings}
                to="/admin/marketplace/listings"
                search={{ view: "live", test }}
              />
              <Kpi
                label="Held earnings"
                value={money(data.held.cents)}
                sub={`${data.held.count} purchase${data.held.count === 1 ? "" : "s"} not paid out`}
                to="/admin/marketplace/purchases"
                search={{ test }}
              />
              <Kpi
                label="Open flags"
                value={data.openFlags}
                tone={data.openFlags > 0 ? "attention" : "default"}
                to="/admin/marketplace/flags"
                search={{ open: true }}
              />
            </div>
            {data.held.count > 0 ? (
              <Panel className="divide-y divide-divider">
                <HeldRow
                  label="Waiting on the coach to set up payouts"
                  {...data.held.byKind.awaiting_coach_setup}
                />
                <HeldRow label="Buyer payment due" {...data.held.byKind.payment_due} />
                <HeldRow
                  label="Paid, not yet sent to the coach"
                  {...data.held.byKind.not_transferred}
                />
              </Panel>
            ) : null}
          </Section>

          <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
            <Section title={`Top plans · ${windowLabel}`}>
              <Panel>
                {data.topPlans.length === 0 ? (
                  <EmptyRow>No listings yet.</EmptyRow>
                ) : (
                  <ul className="divide-y divide-divider">
                    {data.topPlans.map((p, i) => (
                      <li key={p.planId}>
                        <Link
                          to="/admin/marketplace/listings/$planId"
                          params={{ planId: p.planId }}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-elevated"
                        >
                          <span className="w-5 shrink-0 font-mono text-xs text-text-tertiary">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-text-primary">
                              {p.title}
                            </p>
                            <p className="truncate text-xs text-text-secondary">
                              {p.coachName} · {p.views} views ·{" "}
                              <Stars avg={p.ratingAvg} count={p.ratingCount} />
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-display text-lg leading-none text-text-primary">
                              {money(p.grossCents)}
                            </p>
                            <p className="text-xs text-text-tertiary">
                              {p.sales} sold{p.freeClaims ? ` · ${p.freeClaims} free` : ""}
                            </p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </Section>

            <Section title={`Promo code use · ${windowLabel}`}>
              <Panel>
                {data.promo.length === 0 ? (
                  <EmptyRow>No promo codes used on purchases.</EmptyRow>
                ) : (
                  <ul className="divide-y divide-divider">
                    {data.promo.map((p) => (
                      <li
                        key={p.code}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-semibold text-text-primary">
                            {p.code}
                          </p>
                          <p className="text-xs text-text-secondary">
                            {money(p.grossCents)} paid with it
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-display text-lg leading-none text-text-primary">
                            {p.uses}
                          </p>
                          <p className="text-xs text-text-tertiary">{money(p.discountCents)} off</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

function HeldRow({ label, count, cents }: { label: string; count: number; cents: number }) {
  if (!count) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary">
        {money(cents)} <span className="text-text-tertiary">· {count}</span>
      </span>
    </div>
  );
}
