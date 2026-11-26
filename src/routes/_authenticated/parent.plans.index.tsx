import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ParentBottomNav } from "@/components/parent/bottom-nav";

import { PlanCard } from "@/components/plans/plan-card";
import { PageTitle } from "@/components/page-title";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import { FilterBar } from "@/components/plans/filter-bar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listParentPlans } from "@/lib/parent-plans.functions";
import { GoalsDashboard, useGoalsDashboard } from "@/components/parent/goals/goals-dashboard";
import { useActiveSession } from "@/lib/active-session-store";

import { PlansRouteError } from "@/components/plans/plans-error";

export const Route = createFileRoute("/_authenticated/parent/plans/")({
  component: ParentPlansPage,
  errorComponent: ({ error }) => <PlansRouteError error={error instanceof Error ? error : new Error(String(error))} label="Couldn't load plans" />,
});

type StatusFilter = "active" | "benched";
type Tab = "plans" | "goals";

function ParentPlansPage() {
  const [tab, setTab] = useState<Tab>("plans");
  const fetchPlans = useServerFn(listParentPlans);
  const { data, isLoading } = useQuery({
    queryKey: ["parent-plans"],
    queryFn: () => fetchPlans(),
  });
  const { session, clear } = useActiveSession();

  const athletes = data?.athletes ?? [];
  const plans = data?.plans ?? [];

  useEffect(() => {
    if (!data || session?.role !== "parent") return;
    if (!plans.some((plan) => plan.id === session.planId)) clear();
  }, [clear, data, plans, session]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [athleteId, setAthleteId] = useState<string>("");
  const [coachId, setCoachId] = useState<string>("");
  const [goalsAthleteId, setGoalsAthleteId] = useState<string>("");

  const { data: goalsData } = useGoalsDashboard();
  const goalsAthletes = goalsData ?? [];
  const activeGoalsAthleteId = goalsAthleteId || goalsAthletes[0]?.athleteId || "";

  const coaches = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of plans) {
      // Gradus plans have no coach; a Select item can never carry an empty
      // string value, so they get a sentinel id.
      const id = p.coachId || "__gradus";
      if (!map.has(id)) map.set(id, p.isGradus ? "Gradus" : p.coachName);
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [plans]);

  const filtered = useMemo(
    () =>
      plans.filter(
        (p) =>
          p.status === statusFilter &&
          (athleteId === "" || p.athleteId === athleteId) &&
          (coachId === "" || (p.coachId || "__gradus") === coachId),
      ),
    [plans, statusFilter, athleteId, coachId],
  );


  const triggerClass =
    "h-8 w-full rounded-full border-divider bg-card px-3 text-xs font-bold text-text-primary shadow-none";

  return (
    <div className="mx-auto max-w-2xl px-3 pt-6 pb-app-chrome">
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
                <SelectItem value="benched">Recently deleted</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={athleteId || "__all"}
              onValueChange={(v) => setAthleteId(v === "__all" ? "" : v)}
              disabled={athletes.length <= 1}
            >
              <SelectTrigger className={triggerClass} aria-label="Athlete">
                <SelectValue placeholder="All athletes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All athletes</SelectItem>
                {athletes.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
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
          </div>
        ) : goalsAthletes.length > 1 ? (
          <div className="mt-2.5">
            <Select value={activeGoalsAthleteId} onValueChange={setGoalsAthleteId}>
              <SelectTrigger className={triggerClass} aria-label="Athlete">
                <SelectValue placeholder="Select athlete" />
              </SelectTrigger>
              <SelectContent>
                {goalsAthletes.map((a) => (
                  <SelectItem key={a.athleteId} value={a.athleteId}>
                    {a.athleteName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </FilterBar>
      {tab === "goals" ? (
        <GoalsDashboard athleteId={activeGoalsAthleteId} />
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
                to="/parent/plans/$planId"
                planId={p.id}
                title={p.title}
                athleteName={
                  (athleteId === "" && athletes.length > 1 ? `${p.athleteName} · ` : "") +
                  (p.isGradus ? "from Gradus" : `Coach ${p.coachName}`)
                }
                sessionsByState={p.sessionsByState}
                sessionsTotal={p.sessionsTotal}
                muted={statusFilter === "benched"}
                edgeTone={statusFilter === "benched" ? "muted" : "active"}
              />
            ))
          )}
        </div>
      )}

      <ParentBottomNav />
    </div>
  );
}

function EmptyCard({ status }: { status: StatusFilter }) {
  return (
    <div className="rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
      <p className="font-hand text-2xl text-text-secondary">
        {status === "active"
          ? "No active plans — your coach will share one here."
          : "Nothing deleted in the last 30 days."}
      </p>
    </div>
  );
}
