import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { AthleteBottomNav } from "@/components/athlete/bottom-nav";

import { PlanCard } from "@/components/plans/plan-card";
import { PageTitle } from "@/components/page-title";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import { FilterBar } from "@/components/plans/filter-bar";
import { listAthletePlans } from "@/lib/athlete-plans.functions";
import {
  getAthleteGoalsDashboard,
  updateAthleteLongTermGoal,
  updateAthleteMotivation,
} from "@/lib/athlete-goals.functions";
import { SportGoalCard } from "@/components/parent/goals/sport-goal-card";
import { MotivationCard } from "@/components/athlete/motivation-card";
import { useActiveSession } from "@/lib/active-session-store";

export const Route = createFileRoute("/_authenticated/athlete/plans/")({
  component: AthletePlansPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-3 py-6">
      <div className="rounded-2xl border border-divider bg-card p-6 text-sm text-text-secondary">
        Couldn&apos;t load plans: {error.message}
      </div>
    </div>
  ),
});

type StatusFilter = "active" | "benched";
type Tab = "plans" | "goals";

function prettySport(s: string): string {
  if (!s) return "Other";
  return s
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function AthletePlansPage() {
  const fetchPlans = useServerFn(listAthletePlans);
  const { data, isLoading } = useQuery({
    queryKey: ["athlete-plans"],
    queryFn: () => fetchPlans(),
  });
  const { session, clear } = useActiveSession();

  const plans = data?.plans ?? [];

  useEffect(() => {
    if (!data || session?.role !== "athlete") return;
    if (!plans.some((plan) => plan.id === session.planId)) clear();
  }, [clear, data, plans, session]);

  const [tab, setTab] = useState<Tab>("plans");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [coachId, setCoachId] = useState<string>("");
  const [sport, setSport] = useState<string>("");

  const coaches = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of plans) {
      if (!map.has(p.coachId)) map.set(p.coachId, p.coachName);
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [plans]);

  const sports = useMemo(() => {
    const set = new Set<string>();
    for (const p of plans) if (p.sport) set.add(p.sport);
    return Array.from(set).sort((a, b) => prettySport(a).localeCompare(prettySport(b)));
  }, [plans]);

  const filtered = useMemo(
    () =>
      plans.filter(
        (p) =>
          p.status === statusFilter &&
          (coachId === "" || p.coachId === coachId) &&
          (sport === "" || p.sport === sport),
      ),
    [plans, statusFilter, coachId, sport],
  );

  const triggerClass =
    "h-8 w-full rounded-full border-divider bg-card px-3 text-xs font-bold text-text-primary shadow-none";

  return (
    <div className="mx-auto max-w-2xl px-3 pt-6 pb-24">
      <PageTitle>Plans</PageTitle>

      <FilterBar className="mt-4">
        <SegmentedToggle
          value={tab}
          onChange={setTab}
          options={[
            { key: "plans", label: "Plans" },
            { key: "goals", label: "Goals" },
          ]}
        />
        {tab === "plans" ? (
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className={triggerClass} aria-label="Plan status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="benched">Benched</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={coachId || "__all"}
              onValueChange={(v) => setCoachId(v === "__all" ? "" : v)}
              disabled={coaches.length <= 1}
            >
              <SelectTrigger className={triggerClass} aria-label="Coach">
                <SelectValue placeholder="All coaches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All coaches</SelectItem>
                {coaches.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={sport || "__all"}
              onValueChange={(v) => setSport(v === "__all" ? "" : v)}
              disabled={sports.length <= 1}
            >
              <SelectTrigger className={triggerClass} aria-label="Sport">
                <SelectValue placeholder="All sports" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All sports</SelectItem>
                {sports.map((s) => (
                  <SelectItem key={s} value={s}>
                    {prettySport(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </FilterBar>

      {tab === "goals" ? (
        <AthleteGoalsView />
      ) : (
        <div className="mt-5 space-y-3">
          {isLoading ? (
            <p className="py-5 text-center text-sm text-text-secondary">Loading…</p>
          ) : filtered.length === 0 ? (
            <EmptyCard status={statusFilter} />
          ) : (
            filtered.map((p) => (
              <PlanCard
                key={p.id}
                to="/athlete/plans/$planId"
                planId={p.id}
                title={p.title}
                athleteName={`Coach ${p.coachName}`}
                sessionsByState={p.sessionsByState}
                sessionsTotal={p.sessionsTotal}
                muted={statusFilter === "benched"}
                edgeTone={statusFilter === "benched" ? "muted" : "active"}
              />
            ))
          )}
        </div>
      )}


      <AthleteBottomNav />
    </div>
  );
}

function EmptyCard({ status }: { status: StatusFilter }) {
  return (
    <div className="rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
      <p className="font-hand text-2xl text-text-secondary">
        {status === "active"
          ? "No active plans yet — your coach will share one here."
          : "No benched plans."}
      </p>
    </div>
  );
}

function AthleteGoalsView() {
  const fetchDashboard = useServerFn(getAthleteGoalsDashboard);
  const updateGoal = useServerFn(updateAthleteLongTermGoal);
  const updateMotivation = useServerFn(updateAthleteMotivation);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["athlete-goals-dashboard"],
    queryFn: () => fetchDashboard(),
  });

  const goalMutation = useMutation({
    mutationFn: (vars: { sport: string; longTermGoal: string }) =>
      updateGoal({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["athlete-goals-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["parent-goals-dashboard"] });
    },
  });

  const motivationMutation = useMutation({
    mutationFn: (motivation: string) => updateMotivation({ data: { motivation } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["athlete-goals-dashboard"] });
    },
  });

  if (isLoading) {
    return (
      <p className="mt-5 py-5 text-center text-sm text-text-secondary">
        Loading goals…
      </p>
    );
  }
  if (!data) {
    return (
      <div className="mt-5 rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
        <p className="font-hand text-2xl text-text-secondary">
          No goals set yet.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-5 space-y-4">
      {data.sports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
          <p className="font-hand text-2xl text-text-secondary">
            No goals set yet.
          </p>
        </div>
      ) : (
        data.sports.map((g) => (
          <SportGoalCard
            key={g.sport}
            goal={g}
            onSaveLongTermGoal={async (value) => {
              await goalMutation.mutateAsync({ sport: g.sport, longTermGoal: value });
            }}
          />
        ))
      )}
      <MotivationCard
        value={data.motivation}
        onSave={async (value) => {
          await motivationMutation.mutateAsync(value);
        }}
      />
    </div>
  );
}
