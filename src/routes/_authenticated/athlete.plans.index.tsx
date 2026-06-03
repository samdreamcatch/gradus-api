import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
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
import { listAthletePlans } from "@/lib/athlete-plans.functions";

export const Route = createFileRoute("/_authenticated/athlete/plans/")({
  component: AthletePlansPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="rounded-2xl border border-divider bg-card p-6 text-sm text-text-secondary">
        Couldn&apos;t load plans: {error.message}
      </div>
    </div>
  ),
});

type StatusFilter = "active" | "benched";

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

  const plans = data?.plans ?? [];

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
      <PageTitle subtitle={plans.length > 0 ? "From your coach" : undefined}>Plans</PageTitle>

      <div className="mt-4 grid grid-cols-3 gap-2">
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
