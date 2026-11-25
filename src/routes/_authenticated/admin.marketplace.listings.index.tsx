import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ShieldAlert } from "lucide-react";
import { adminMarketplaceListings } from "@/lib/admin-marketplace.functions";
import { chipClasses } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import {
  AdminPageHeader,
  Cover,
  EmptyRow,
  ListingStatusTag,
  Panel,
  Stars,
  dollars,
  money,
  prettify,
  shortDate,
} from "@/components/admin/marketplace-ui";

const VIEWS = [
  { value: "live", label: "Live" },
  { value: "recent", label: "Newly published (14 days)" },
  { value: "all", label: "All listings" },
] as const;

const searchSchema = z.object({
  view: fallback(z.enum(["all", "live", "recent"]), "live").default("live"),
  q: fallback(z.string(), "").default(""),
  test: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/admin/marketplace/listings/")({
  validateSearch: zodValidator(searchSchema),
  component: MarketplaceListings,
});

function MarketplaceListings() {
  const { view, q, test } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (draft !== q) navigate({ search: (prev: any) => ({ ...prev, q: draft }), replace: true });
    }, 300);
    return () => window.clearTimeout(t);
  }, [draft, q, navigate]);

  const listFn = useServerFn(adminMarketplaceListings);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-marketplace-listings", view, q, test],
    queryFn: () => listFn({ data: { view, q, includeTest: test } }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-10">
      <AdminPageHeader
        title="Listings"
        subtitle={
          view === "recent"
            ? "Live listings published or changed in the last 14 days, newest first, to spot-check."
            : "Every marketplace listing and its media. Open one to see the cover, moves, reports and sales."
        }
        back={{ to: "/admin/marketplace", label: "Marketplace" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {VIEWS.map((v) => (
            <Link
              key={v.value}
              from={Route.fullPath}
              search={(prev: any) => ({ ...prev, view: v.value })}
              className={chipClasses({
                tone: "muted",
                weight: "medium",
                selected: view === v.value,
              })}
            >
              {v.label}
            </Link>
          ))}
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search by title"
            className="ml-auto w-full max-w-xs"
            aria-label="Search listings by title"
          />
        </div>
      </AdminPageHeader>

      <Panel>
        {isLoading ? (
          <EmptyRow>Loading…</EmptyRow>
        ) : error ? (
          <EmptyRow>Couldn't load listings. {error instanceof Error ? error.message : ""}</EmptyRow>
        ) : !data?.length ? (
          <EmptyRow>No listings.</EmptyRow>
        ) : (
          <ul className="divide-y divide-divider">
            {data.map((l) => (
              <li key={l.id}>
                <Link
                  to="/admin/marketplace/listings/$planId"
                  params={{ planId: l.id }}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-elevated"
                >
                  <Cover url={l.coverUrl} hasVideo={l.hasVideo} className="h-14 w-20 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold text-text-primary">
                      <span className="truncate">{l.title}</span>
                      <ListingStatusTag live={l.live} status={l.status} />
                      {l.openFlags ? (
                        <span className="inline-flex items-center gap-0.5 text-xs text-destructive">
                          <ShieldAlert className="size-3.5" />
                          {l.openFlags}
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-text-secondary">
                      {l.coachName} · {prettify(l.productType)} · {prettify(l.sport)}
                      {l.level ? ` · ${prettify(l.level)}` : ""}
                    </p>
                    <p className="truncate text-xs text-text-tertiary">
                      {l.views} views · <Stars avg={l.ratingAvg} count={l.ratingCount} /> · updated{" "}
                      {shortDate(l.updatedAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-lg leading-none text-text-primary">
                      {l.price > 0 ? dollars(l.price) : "Free"}
                    </p>
                    <p className="text-xs text-text-tertiary">
                      {l.sales} sold · {money(l.grossCents)}
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
