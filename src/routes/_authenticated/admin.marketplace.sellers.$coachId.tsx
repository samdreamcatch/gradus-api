import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Mail, ShieldAlert } from "lucide-react";
import { adminMarketplaceSeller } from "@/lib/admin-marketplace.functions";
import { Tag } from "@/components/ui/tag";
import {
  AdminPageHeader,
  Cover,
  EmptyRow,
  Kpi,
  ListingStatusTag,
  Panel,
  PayoutTag,
  Section,
  Stars,
  TierTag,
  dollars,
  money,
  prettify,
  shortDate,
} from "@/components/admin/marketplace-ui";
import { PurchaseList } from "@/components/admin/marketplace-purchases";

export const Route = createFileRoute("/_authenticated/admin/marketplace/sellers/$coachId")({
  component: SellerDetail,
});

function SellerDetail() {
  const { coachId } = Route.useParams();
  const detailFn = useServerFn(adminMarketplaceSeller);
  const {
    data: s,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin-marketplace-seller", coachId],
    queryFn: () => detailFn({ data: { coachId } }),
  });

  if (isLoading) {
    return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-text-secondary">Loading…</div>;
  }
  if (error || !s) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-10">
        <AdminPageHeader
          title="Seller"
          back={{ to: "/admin/marketplace/sellers", label: "Sellers" }}
        />
        <p className="text-sm text-destructive">
          Couldn't load this seller. {error instanceof Error ? error.message : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <AdminPageHeader
        title={s.name}
        back={{ to: "/admin/marketplace/sellers", label: "Sellers" }}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {s.isTest ? <Tag>test</Tag> : null}
            <TierTag tier={s.tier} />
            <PayoutTag state={s.payoutState} />
            {s.inClub ? <Tag>In a club</Tag> : null}
            {s.subscriptionStatus ? <Tag>{prettify(s.subscriptionStatus)}</Tag> : null}
            <span>Coach since {shortDate(s.createdAt)}</span>
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-4">
          {s.photoUrl ? (
            <img
              src={s.photoUrl}
              alt=""
              className="size-14 rounded-full border border-divider object-cover"
            />
          ) : null}
          <div className="space-y-1 text-sm">
            {s.email ? (
              <a
                href={`mailto:${s.email}`}
                className="inline-flex items-center gap-1 font-semibold text-accent-ink hover:underline"
              >
                <Mail className="size-3.5" /> {s.email}
              </a>
            ) : (
              <p className="text-text-tertiary">No email on file</p>
            )}
            {s.userId ? (
              <Link
                to="/admin/users/$userId"
                params={{ userId: s.userId }}
                className="block text-xs font-semibold text-accent-ink hover:underline"
              >
                User account
              </Link>
            ) : null}
          </div>
        </div>
      </AdminPageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <Kpi label="Gross sales" value={money(s.grossCents)} sub={`${s.sales} sales`} />
        <Kpi label="Coach earnings" value={money(s.coachPayoutCents)} />
        <Kpi
          label="Held"
          value={money(s.held.cents)}
          sub={
            s.held.count
              ? [
                  s.held.byKind.awaiting_coach_setup.count
                    ? `${s.held.byKind.awaiting_coach_setup.count} awaiting payouts`
                    : null,
                  s.held.byKind.payment_due.count
                    ? `${s.held.byKind.payment_due.count} payment due`
                    : null,
                  s.held.byKind.not_transferred.count
                    ? `${s.held.byKind.not_transferred.count} not sent`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Nothing held"
          }
        />
        <Kpi label="Rating" value={<Stars avg={s.ratingAvg} count={s.ratingCount} />} />
        <Kpi label="Live listings" value={s.liveListings} />
        <Kpi label="Not live" value={s.draftListings} sub="Drafts, or hidden from buyers" />
        <Kpi
          label="Open flags"
          value={s.openFlags}
          tone={s.openFlags ? "attention" : "default"}
          to="/admin/marketplace/flags"
          search={{ open: true }}
        />
      </div>

      <Section title={`Listings (${s.listings.length})`}>
        <Panel>
          {s.listings.length === 0 ? (
            <EmptyRow>No listings.</EmptyRow>
          ) : (
            <ul className="divide-y divide-divider">
              {s.listings.map((l) => (
                <li key={l.id}>
                  <Link
                    to="/admin/marketplace/listings/$planId"
                    params={{ planId: l.id }}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-elevated"
                  >
                    <Cover url={l.coverUrl} hasVideo={l.hasVideo} className="h-12 w-16 shrink-0" />
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
                        {prettify(l.productType)} · {prettify(l.sport)} · {l.views} views · updated{" "}
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
      </Section>

      <Section title={`Sales (${s.purchases.length})`}>
        <PurchaseList rows={s.purchases} hideCoach empty="No sales yet." />
      </Section>
    </div>
  );
}
