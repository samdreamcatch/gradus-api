import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { PlanCard } from "@/components/plans/plan-card";
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
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="rounded-2xl border border-divider bg-card p-6 text-sm text-text-secondary">
        Couldn&apos;t load plans: {error.message}
      </div>
    </div>
  ),
});

type StatusFilter = "active" | "benched";

function ParentPlansPage() {
  const fetchPlans = useServerFn(listParentPlans);
  const { data, isLoading } = useQuery({
    queryKey: ["parent-plans"],
    queryFn: () => fetchPlans(),
  });

  const athletes = data?.athletes ?? [];
  const plans = data?.plans ?? [];

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [athleteId, setAthleteId] = useState<string>("");

  const filtered = useMemo(
    () =>
      plans.filter(
        (p) =>
          p.status === statusFilter &&
          (athleteId === "" || p.athleteId === athleteId),
      ),
    [plans, statusFilter, athleteId],
  );

  const subtitleNames =
    athleteId === ""
      ? athletes.map((a) => a.name.split(" ")[0]).join(" & ")
      : athletes.find((a) => a.id === athleteId)?.name.split(" ")[0] ?? "";

  const triggerClass =
    "h-8 w-full rounded-full border-divider bg-card px-3 text-xs font-bold text-text-primary shadow-none";

  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 pb-24">
      <p className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
        Plans
      </p>
      {subtitleNames ? (
        <p className="mt-2 font-hand text-xl text-text-secondary">
          What {subtitleNames} is working on
        </p>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-2">
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
      </div>

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
