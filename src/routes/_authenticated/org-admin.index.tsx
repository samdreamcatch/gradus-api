import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { getClubReadiness } from "@/lib/trust-center.functions";
import { useOrgId } from "@/components/org-admin/org-shared";
import { PageTitle } from "@/components/page-title";
import { Progress } from "@/components/ui/progress";
import { AttentionRow, SectionLabel, StatTile, StatusTag } from "@/components/org-admin/trust-ui";
import { sportDisplayLabel } from "@/lib/coach-sports";
import { getClubNotificationCounts } from "@/lib/club-notifications.functions";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { getClubCoachWeeks } from "@/lib/club-coaches.functions";
import { weekStart, sumCoachWeeks, targetPercent } from "@/lib/club-coach-metrics";

export const Route = createFileRoute("/_authenticated/org-admin/")({
  head: () => ({
    meta: [
      { title: "Home · Gradus Club Admin" },
      { name: "description", content: "Your club's safe sport readiness at a glance." },
      { property: "og:title", content: "Home · Gradus Club Admin" },
      { property: "og:description", content: "Your club's safe sport readiness at a glance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrustCenter,
});

const fmtPct = (n: number | null) => (n === null ? "—" : `${n}%`);
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function TrustCenter() {
  const { orgId } = useOrgId();
  const weeksFn = useServerFn(getClubCoachWeeks);
  const weeks = useQuery({
    queryKey: ["club-coach-weeks", orgId],
    queryFn: () => {
      if (!orgId) throw new Error("No club selected");
      return weeksFn({ data: { organizationId: orgId } });
    },
    enabled: !!orgId,
    retry: false,
  });
  const currentWeeks = (weeks.data?.weeks ?? []).filter((w) => w.week_start === weekStart());
  const practice = sumCoachWeeks(currentWeeks);
  const countFn = useServerFn(getClubNotificationCounts);
  const counts = useQuery({
    queryKey: ["club-notification-counts", orgId],
    queryFn: () => {
      if (!orgId) throw new Error("No club selected");
      return countFn({ data: { organizationId: orgId } });
    },
    enabled: !!orgId,
    retry: false,
  });
  const fn = useServerFn(getClubReadiness);
  const q = useQuery({
    queryKey: ["trust-center", orgId],
    queryFn: () => {
      if (!orgId) throw new Error("No club selected");
      return fn({ data: { organizationId: orgId } });
    },
    enabled: !!orgId,
  });
  const r = q.data;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <PageTitle>Home</PageTitle>
        </div>
        {r ? <StatusTag status={r.status} /> : null}
        <Button variant="outline" asChild>
          <Link to="/org-admin/notifications">
            Notifications{counts.data ? ` · ${counts.data.open} open` : ""}
          </Link>
        </Button>
      </div>

      <section className="border-y border-divider py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-h3">Practice · this week</h2>
          <Button variant="outline" asChild><Link to="/org-admin/coaches">Coaches</Link></Button>
        </div>
        {weeks.isError ? <p role="alert" className="mt-3 text-sm text-text-secondary">Weekly practice records become available after this draft is accepted.</p> :
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div><p className="text-sm text-text-secondary">Practice / target minutes</p><p className="font-display text-h2">{weeks.data ? Math.round(practice.practice).toLocaleString() : "—"} / {weeks.data && practice.target !== null ? Math.round(practice.target).toLocaleString() : "—"}</p></div>
            <div><p className="text-sm text-text-secondary">Of recorded target</p><p className="font-display text-h2">{weeks.data && targetPercent(practice.practice, practice.target) !== null ? `${targetPercent(practice.practice, practice.target)}%` : "—"}</p></div>
            <div><p className="text-sm text-text-secondary">Sessions this week</p><p className="font-display text-h2">{weeks.data ? practice.sessions.toLocaleString() : "—"}</p></div>
          </div>}
      </section>

      {q.isError ? (
        <p role="alert" className="text-text-secondary">
          Could not load the club overview. New club records become available after this draft is
          accepted.
        </p>
      ) : !r ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="size-4 animate-spin" /> Loading readiness…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Policy sign-off" value={fmtPct(r.signOffPct)} />
            <StatTile
              label="Coaches ready"
              value={`${r.coachesReady} / ${r.coachesTotal}`}
              note={
                r.coachesTotal - r.coachesReady > 0
                  ? `${r.coachesTotal - r.coachesReady} left to sign`
                  : undefined
              }
            />
            <StatTile label="Families covered" value={fmtPct(r.familiesCoveredPct)} />
            <StatTile label="Open items" value={String(r.items.length)} />
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <section className="lg:col-span-8">
              <SectionLabel>Needs attention</SectionLabel>
              {r.items.length ? (
                <div className="space-y-2">
                  {r.items.map((i) => (
                    <AttentionRow key={i.id} item={i} />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-divider bg-card p-6">
                  <p className="font-hand text-2xl text-accent-ink">All clear.</p>
                  <p className="text-sm text-text-secondary">
                    Nothing needs your attention right now.
                  </p>
                </div>
              )}
            </section>

            <aside className="space-y-6 lg:col-span-4">
              <div>
                <SectionLabel>Sign-off by sport</SectionLabel>
                <div className="space-y-3 rounded-lg border border-divider bg-card p-4">
                  {r.bySport.length ? (
                    r.bySport.map((s) => (
                      <div key={s.sport} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-text-primary">{sportDisplayLabel(s.sport)}</span>
                          <span className="font-mono text-text-secondary">
                            {s.done}/{s.total}
                          </span>
                        </div>
                        <Progress value={s.total ? (s.done / s.total) * 100 : 0} />
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-text-secondary">
                      No documents require acknowledgement yet.
                    </p>
                  )}
                </div>
              </div>
              <div>
                <SectionLabel>Recent activity</SectionLabel>
                <ul className="divide-y divide-divider rounded-lg border border-divider bg-card">
                  {r.activity.length ? (
                    r.activity.map((a, i) => (
                      <li key={i} className="flex gap-3 px-4 py-2.5 text-xs">
                        <span className="w-12 shrink-0 font-mono text-text-tertiary">
                          {fmtWhen(a.at)}
                        </span>
                        <span className="text-text-primary">{a.text}</span>
                      </li>
                    ))
                  ) : (
                    <li className="px-4 py-3 text-xs text-text-secondary">No activity yet.</li>
                  )}
                </ul>
              </div>
            </aside>
          </div>
          <p className="text-xs text-text-tertiary">
            Readiness reflects the records in Gradus. It isn't a legal or certification judgement.
          </p>
        </>
      )}
    </div>
  );
}
