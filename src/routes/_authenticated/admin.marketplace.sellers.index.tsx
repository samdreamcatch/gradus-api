import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ShieldAlert } from "lucide-react";
import { adminMarketplaceSellers } from "@/lib/admin-marketplace.functions";
import { Input } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import {
  AdminPageHeader,
  EmptyRow,
  Panel,
  PayoutTag,
  Stars,
  TierTag,
  money,
} from "@/components/admin/marketplace-ui";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  test: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/admin/marketplace/sellers/")({
  validateSearch: zodValidator(searchSchema),
  component: MarketplaceSellers,
});

function MarketplaceSellers() {
  const { q, test } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (draft !== q) navigate({ search: (prev: any) => ({ ...prev, q: draft }), replace: true });
    }, 300);
    return () => window.clearTimeout(t);
  }, [draft, q, navigate]);

  const listFn = useServerFn(adminMarketplaceSellers);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-marketplace-sellers", q, test],
    queryFn: () => listFn({ data: { q, includeTest: test } }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-10">
      <AdminPageHeader
        title="Sellers"
        subtitle="Coaches with marketplace listings or sales: plan tier, payouts, listings and sales."
        back={{ to: "/admin/marketplace", label: "Marketplace" }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search by name or email"
          className="w-full max-w-xs"
          aria-label="Search sellers"
        />
      </AdminPageHeader>

      <Panel>
        {isLoading ? (
          <EmptyRow>Loading…</EmptyRow>
        ) : error ? (
          <EmptyRow>Couldn't load sellers. {error instanceof Error ? error.message : ""}</EmptyRow>
        ) : !data?.length ? (
          <EmptyRow>No sellers yet.</EmptyRow>
        ) : (
          <ul className="divide-y divide-divider">
            {data.map((s) => (
              <li key={s.coachId}>
                <Link
                  to="/admin/marketplace/sellers/$coachId"
                  params={{ coachId: s.coachId }}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-elevated"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text-primary">
                      <span className="truncate">{s.name}</span>
                      {s.isTest ? <Tag>test</Tag> : null}
                      <TierTag tier={s.tier} />
                      <PayoutTag state={s.payoutState} />
                      {s.inClub ? <Tag>In a club</Tag> : null}
                      {s.openFlags ? (
                        <span className="inline-flex items-center gap-0.5 text-xs text-destructive">
                          <ShieldAlert className="size-3.5" />
                          {s.openFlags}
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-text-secondary">{s.email ?? "No email"}</p>
                    <p className="truncate text-xs text-text-tertiary">
                      {s.liveListings} live · {s.draftListings} not live ·{" "}
                      <Stars avg={s.ratingAvg} count={s.ratingCount} />
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-lg leading-none text-text-primary">
                      {money(s.grossCents)}
                    </p>
                    <p className="text-xs text-text-tertiary">
                      {s.sales} sold{s.heldCents ? ` · ${money(s.heldCents)} held` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
