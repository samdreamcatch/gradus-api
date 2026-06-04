import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { PageTitle } from "@/components/page-title";
import { RosterCard } from "@/components/coach/roster-card";
import { InviteCard } from "@/components/onboarding/invite-card";
import { Button } from "@/components/ui/button";
import { getCoachRoster } from "@/lib/coach-roster.functions";

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
  const { data: athletes } = useSuspenseQuery(rosterQueryOptions);
  const router = useRouter();

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-3xl px-4 pt-8 pb-24">
        <PageTitle subtitle={athletes.length > 0 ? `${athletes.length} athlete${athletes.length === 1 ? "" : "s"}` : undefined}>
          Roster
        </PageTitle>

        {athletes.length === 0 ? (
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
          <ul className="mt-6 space-y-4">
            {athletes.map((a) => (
              <li key={a.athleteId}>
                <RosterCard athlete={a} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <CoachBottomNav />
    </>
  );
}
