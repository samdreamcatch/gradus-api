import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getParentGoalsDashboard } from "@/lib/parent-goals.functions";
import { SportGoalCard } from "./sport-goal-card";

export function GoalsDashboard() {
  const fetchDashboard = useServerFn(getParentGoalsDashboard);
  const { data, isLoading } = useQuery({
    queryKey: ["parent-goals-dashboard"],
    queryFn: () => fetchDashboard(),
  });

  const athletes = data ?? [];
  const [athleteId, setAthleteId] = useState<string>("");

  useEffect(() => {
    if (!athleteId && athletes.length > 0) setAthleteId(athletes[0].athleteId);
  }, [athletes, athleteId]);

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
      {athletes.length > 1 && (
        <Select value={active.athleteId} onValueChange={setAthleteId}>
          <SelectTrigger
            className="h-10 w-full rounded-full border-divider bg-card px-4 text-sm font-bold text-text-primary shadow-none"
            aria-label="Select athlete"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {athletes.map((a) => (
              <SelectItem key={a.athleteId} value={a.athleteId}>
                {a.athleteName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

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
