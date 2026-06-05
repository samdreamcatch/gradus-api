import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { PlanCard } from "@/components/plans/plan-card";
import { PageTitle } from "@/components/page-title";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listParentPlans } from "@/lib/parent-plans.functions";

export const Route = createFileRoute("/_authenticated/parent/plans/")({
  component: ParentPlansPage,
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

function ParentPlansPage() {
  const [tab, setTab] = useState<Tab>("plans");
  const fetchPlans = useServerFn(listParentPlans);
  const { data, isLoading } = useQuery({
    queryKey: ["parent-plans"],
    queryFn: () => fetchPlans(),
  });

  const athletes = data?.athletes ?? [];
  const plans = data?.plans ?? [];

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [athleteId, setAthleteId] = useState<string>("");
  const [coachId, setCoachId] = useState<string>("");

  const coaches = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of plans) {
      if (!map.has(p.coachId)) map.set(p.coachId, p.coachName);
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
          (coachId === "" || p.coachId === coachId),
      ),
    [plans, statusFilter, athleteId, coachId],
  );


  const triggerClass =
    "h-8 w-full rounded-full border-divider bg-card px-3 text-xs font-bold text-text-primary shadow-none";

  return (
    <div className="mx-auto max-w-2xl px-3 pt-6 pb-24">
      <PageTitle>Plans</PageTitle>

      <div className="mt-4 rounded-[28px] bg-[#DCEAF5] p-2.5 shadow-sm dark:bg-[#1c2a3a]">
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
        ) : null}
      </div>
      {tab === "goals" ? (
        <div className="mt-5 rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
          <p className="font-hand text-2xl text-text-secondary">Goals coming soon.</p>
        </div>
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
                  athleteId === "" && athletes.length > 1
                    ? `${p.athleteName} · Coach ${p.coachName}`
                    : `Coach ${p.coachName}`
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
          : "No benched plans."}
      </p>
    </div>
  );
}
