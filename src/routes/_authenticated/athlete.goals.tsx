import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AthleteBottomNav } from "@/components/athlete/bottom-nav";
import { PageTitle } from "@/components/page-title";
import { SportGoalCard } from "@/components/parent/goals/sport-goal-card";
import { getAthleteGoalsDashboard } from "@/lib/athlete-goals.functions";

export const Route = createFileRoute("/_authenticated/athlete/goals")({
  component: AthleteGoalsPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-3 py-6">
      <div className="rounded-2xl border border-divider bg-card p-6 text-sm text-text-secondary">
        Couldn&apos;t load goals: {error.message}
      </div>
    </div>
  ),
});

function AthleteGoalsPage() {
  const fetchDashboard = useServerFn(getAthleteGoalsDashboard);
  const { data, isLoading } = useQuery({
    queryKey: ["athlete-goals-dashboard"],
    queryFn: () => fetchDashboard(),
  });

  return (
    <div className="mx-auto max-w-2xl px-3 pt-6 pb-24">
      <PageTitle>Goals</PageTitle>

      {isLoading ? (
        <p className="mt-5 py-5 text-center text-sm text-text-secondary">
          Loading goals…
        </p>
      ) : !data || data.sports.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
          <p className="font-hand text-2xl text-text-secondary">
            No goals set yet.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {data.sports.map((g) => (
            <SportGoalCard key={g.sport} goal={g} />
          ))}
        </div>
      )}

      <AthleteBottomNav />
    </div>
  );
}
