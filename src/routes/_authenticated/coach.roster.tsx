import { useMemo, useState } from "react";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { PageTitle } from "@/components/page-title";
import { RosterCard } from "@/components/coach/roster-card";
import { SportFilterChips } from "@/components/coach/sport-filter-chips";
import { WeekScheduleView } from "@/components/coach/week-schedule-view";
import { AthleteDetailSheet } from "@/components/coach/athlete-detail-sheet";
import { InviteCard } from "@/components/onboarding/invite-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCoachRoster } from "@/lib/coach-roster.functions";

type RosterTab = "athletes" | "schedule";

function SegmentedToggle({ tab, onChange }: { tab: RosterTab; onChange: (t: RosterTab) => void }) {
  const tabs: { key: RosterTab; label: string }[] = [
    { key: "athletes", label: "Athletes" },
    { key: "schedule", label: "Schedule" },
  ];
  return (
    <div className="flex rounded-lg border border-foreground/15 bg-popover p-1 shadow-sm">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            "flex-1 rounded-md py-1.5 text-sm font-bold transition",
            tab === t.key
              ? "bg-accent text-accent-foreground shadow-sm"
              : "text-text-secondary hover:text-text-primary",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const rosterQueryOptions = queryOptions({
  queryKey: ["coach", "roster"],
  queryFn: () => getCoachRoster(),
});

export const Route = createFileRoute("/_authenticated/coach/roster")({
  loader: ({ context }) => context.queryClient.ensureQueryData(rosterQueryOptions),
  component: RosterPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-24" role="alert">
      <PageTitle>Roster</PageTitle>
      <p className="mt-4 text-text-secondary">
        Couldn't load your roster: {error.message}
      </p>
      <CoachBottomNav />
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-24">
      <p>Roster not found.</p>
      <CoachBottomNav />
    </div>
  ),
});

function RosterPage() {
  const { data: roster } = useSuspenseQuery(rosterQueryOptions);
  const { athletes, coachSports } = roster;
  const router = useRouter();
  const [tab, setTab] = useState<RosterTab>("athletes");
  const [selectedSport, setSelectedSport] = useState<string | null>(null);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);

  const sports = useMemo(() => {
    const set = new Set<string>(coachSports);
    for (const a of athletes) if (a.sport) set.add(a.sport);
    return [...set].sort();
  }, [athletes, coachSports]);

  const visibleAthletes = useMemo(() => {
    if (!selectedSport) return athletes;
    return athletes.filter((a) => a.sport === selectedSport);
  }, [athletes, selectedSport]);




  return (
    <>
      <div className="mx-auto min-h-dvh max-w-3xl px-4 pt-8 pb-24">
        <PageTitle>Roster</PageTitle>

        <div className="mt-4">
          <SegmentedToggle tab={tab} onChange={setTab} />
        </div>

        {athletes.length > 0 && (
          <SportFilterChips
            sports={sports}
            selected={selectedSport}
            onSelect={setSelectedSport}
          />
        )}

        {tab === "athletes" ? (
          athletes.length === 0 ? (
            <div className="mt-8 rounded-2xl bg-card p-6 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.15)] sm:p-8">
              <h2 className="font-display text-xl text-text-primary">
                No athletes yet
              </h2>
              <p className="mt-2 text-sm text-text-secondary">
                Share your invite code with parents — once they link their athlete to you, they'll show up here.
              </p>
              <div className="mt-5">
                <InviteCard />
              </div>
              <div className="mt-5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => router.invalidate()}
                >
                  Refresh
                </Button>
              </div>
            </div>
          ) : (
            <ul className="mt-5 space-y-3">
              {visibleAthletes.map((a) => (
                <li key={a.athleteId}>
                  <RosterCard athlete={a} />
                </li>
              ))}
            </ul>
          )
        ) : (
          <WeekScheduleView athletes={visibleAthletes} />
        )}
      </div>
      <CoachBottomNav />
    </>
  );
}
