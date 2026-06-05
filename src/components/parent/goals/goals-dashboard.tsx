import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getParentGoalsDashboard } from "@/lib/parent-goals.functions";
import { SportGoalCard } from "./sport-goal-card";

export type GoalsAthlete = {
  athleteId: string;
  athleteName: string;
};

export function useGoalsDashboard() {
  const fetchDashboard = useServerFn(getParentGoalsDashboard);
  return useQuery({
    queryKey: ["parent-goals-dashboard"],
    queryFn: () => fetchDashboard(),
  });
}

export function GoalsDashboard({ athleteId }: { athleteId: string }) {
  const { data, isLoading } = useGoalsDashboard();
  const athletes = data ?? [];

  if (isLoading) {
    return (
      <p className="mt-5 py-5 text-center text-sm text-text-secondary">
        Loading goals…
      </p>
    );
  }

  if (athletes.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
        <p className="font-hand text-2xl text-text-secondary">
          Add an athlete to start tracking goals.
        </p>
      </div>
    );
  }

  const active = athletes.find((a) => a.athleteId === athleteId) ?? athletes[0];

  return (
    <div className="mt-5 space-y-4">
      {active.sports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
          <p className="font-hand text-2xl text-text-secondary">
            No goals set yet for {active.athleteName.split(" ")[0]}.
          </p>
        </div>
      ) : (
        active.sports.map((g) => <SportGoalCard key={g.sport} goal={g} />)
      )}
    </div>
  );
}
