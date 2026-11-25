import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { adminMarketplaceListing } from "@/lib/admin-marketplace.functions";
import { PLAN_REPORT_REASON_LABELS, type PlanReportReason } from "@/lib/plan-reports-types";
import { Tag } from "@/components/ui/tag";
import { Eyebrow } from "@/components/ui/eyebrow";
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

export const Route = createFileRoute("/_authenticated/admin/marketplace/listings/$planId")({
  component: ListingDetail,
});

function ListingDetail() {
  const { planId } = Route.useParams();
  const detailFn = useServerFn(adminMarketplaceListing);
  const {
    data: l,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin-marketplace-listing", planId],
    queryFn: () => detailFn({ data: { planId } }),
  });

  if (isLoading) {
    return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-text-secondary">Loading…</div>;
  }
  if (error || !l) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-10">
        <AdminPageHeader
          title="Listing"
          back={{ to: "/admin/marketplace/listings", label: "Listings" }}
        />
        <p className="text-sm text-destructive">
          Couldn't load this listing. {error instanceof Error ? error.message : ""}
        </p>
      </div>
    );
  }

  const levels = [l.level, l.levelTo].filter(Boolean).map(prettify).join(" → ");

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <AdminPageHeader
        title={l.title}
        back={{ to: "/admin/marketplace/listings", label: "Listings" }}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <ListingStatusTag live={l.live} status={l.status} />
            <span>
              {prettify(l.productType)} · {prettify(l.sport)}
              {levels ? ` · ${levels}` : ""}
            </span>
          </span>
        }
      />

      <div className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {l.videoUrl ? (
            <video
              src={l.videoUrl}
              controls
              playsInline
              preload="metadata"
              poster={l.imageUrl ?? undefined}
              className="aspect-video w-full rounded-xl border border-divider bg-elevated object-cover"
            />
          ) : (
            <Cover url={l.imageUrl} className="aspect-video w-full" />
          )}
          {l.videoUrl && l.imageUrl ? (
            <div className="flex items-center gap-3">
              <Cover url={l.imageUrl} className="h-16 w-24" />
              <p className="text-xs text-text-secondary">
                Cover image (buyers see this; the video plays on the plan page).
              </p>
            </div>
          ) : null}
          <p className="text-xs text-text-tertiary">
            Media links expire after an hour. Reload to refresh them.
          </p>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Price" value={l.price > 0 ? dollars(l.price) : "Free"} />
            <Kpi label="Sales" value={l.sales} sub={money(l.grossCents)} />
            <Kpi label="Views" value={l.views} />
            <Kpi
              label="Open flags"
              value={l.openFlags}
              tone={l.openFlags ? "attention" : "default"}
              to="/admin/marketplace/flags"
              search={{ open: true }}
            />
          </div>
          <Panel className="space-y-2 p-4 text-sm">
            <Eyebrow size="micro" tone="tertiary">
              Seller
            </Eyebrow>
            <Link
              to="/admin/marketplace/sellers/$coachId"
              params={{ coachId: l.coachId }}
              className="block font-semibold text-text-primary hover:underline"
            >
              {l.coachName}
            </Link>
            <div className="flex flex-wrap gap-1.5">
              <TierTag tier={l.coachTier} />
              <PayoutTag state={l.payoutState} />
            </div>
            {l.coachEmail ? (
              <a
                href={`mailto:${l.coachEmail}?subject=${encodeURIComponent(`About your Gradus listing "${l.title}"`)}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent-ink hover:underline"
              >
                <Mail className="size-3.5" /> {l.coachEmail}
              </a>
            ) : null}
          </Panel>
          <Panel className="space-y-1 p-4 text-xs text-text-secondary">
            <p>
              {l.weeks ? `${l.weeks} weeks` : "—"} ·{" "}
              {l.sessionsPerWeek ? `${l.sessionsPerWeek}/week` : "—"}
              {l.lessonCount ? ` · ${l.lessonCount} lessons` : ""}
            </p>
            <p>
              <Stars avg={l.ratingAvg} count={l.ratingCount} />
            </p>
            <p>
              Created {shortDate(l.createdAt)} · updated {shortDate(l.updatedAt)}
            </p>
            <Link
              to="/admin/plans/$planId"
              params={{ planId: l.id }}
              className="inline-block pt-1 font-semibold text-accent-ink hover:underline"
            >
              Plan detail &amp; sessions
            </Link>
          </Panel>
        </div>
      </div>

      <Section title="Description">
        <Panel className="p-4">
          {l.description ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-text-primary">
              {l.description}
            </p>
          ) : (
            <p className="text-sm text-text-tertiary">No description.</p>
          )}
        </Panel>
      </Section>

      <Section title={`Moves (${l.moves.length})`}>
        <Panel>
          {l.moves.length === 0 ? (
            <EmptyRow>No moves.</EmptyRow>
          ) : (
            <ol className="divide-y divide-divider">
              {l.moves.map((m, i) => (
                <li key={m.id} className="flex gap-3 px-4 py-2.5">
                  <span className="w-5 shrink-0 font-mono text-xs text-text-tertiary">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{m.name}</p>
                    {m.description ? (
                      <p className="text-xs text-text-secondary">{m.description}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </Section>

      <Section
        title={`Reports (${l.reports.length})`}
        action={
          <Link
            to="/admin/marketplace/flags"
            search={{ open: false }}
            className="text-xs font-semibold text-accent-ink hover:underline"
          >
            Flags queue
          </Link>
        }
      >
        <Panel>
          {l.reports.length === 0 ? (
            <EmptyRow>No one has reported this plan.</EmptyRow>
          ) : (
            <ul className="divide-y divide-divider">
              {l.reports.map((r) => (
                <li key={r.id} className="space-y-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-text-primary">
                      {PLAN_REPORT_REASON_LABELS[r.reason as PlanReportReason] ??
                        prettify(r.reason)}
                    </span>
                    <span className="flex items-center gap-2">
                      <Tag tone={r.status === "open" ? "accent" : "default"}>
                        {prettify(r.status)}
                      </Tag>
                      <span className="text-[11px] text-text-tertiary">
                        {shortDate(r.createdAt)}
                      </span>
                    </span>
                  </div>
                  {r.note ? <p className="text-sm text-text-secondary">{r.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Section>

      <Section title={`Reviews (${l.ratings.length})`}>
        <Panel>
          {l.ratings.length === 0 ? (
            <EmptyRow>No reviews.</EmptyRow>
          ) : (
            <ul className="divide-y divide-divider">
              {l.ratings.map((r) => (
                <li key={r.id} className="space-y-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-text-primary">
                      {"★".repeat(r.rating)}
                      <span className="text-text-tertiary">
                        {"★".repeat(Math.max(0, 5 - r.rating))}
                      </span>
                    </span>
                    <span className="text-[11px] text-text-tertiary">{shortDate(r.createdAt)}</span>
                  </div>
                  {r.review ? <p className="text-sm text-text-primary">{r.review}</p> : null}
                  {r.coachResponse ? (
                    <p className="rounded-md border border-divider bg-elevated/60 p-2 text-sm text-text-secondary">
                      Coach: {r.coachResponse}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Section>

      <Section title={`Purchases (${l.purchases.length})`}>
        <PurchaseList rows={l.purchases} hideCoach empty="No one has bought this plan." />
      </Section>
    </div>
  );
}
