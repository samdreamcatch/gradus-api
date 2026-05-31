import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { PlanCard } from "@/components/plans/plan-card";
import { cn } from "@/lib/utils";
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

function ParentPlansPage() {
  const fetchPlans = useServerFn(listParentPlans);
  const { data, isLoading } = useQuery({
    queryKey: ["parent-plans"],
    queryFn: () => fetchPlans(),
  });

  const athletes = data?.athletes ?? [];
  const plans = data?.plans ?? [];

  const [selectedAthlete, setSelectedAthlete] = useState<string | "all">(() =>
    athletes.length > 0 ? athletes[0].id : "all",
  );
  // If athletes finish loading after first render, default to first.
  const effectiveSelected =
    selectedAthlete === "all" || athletes.some((a) => a.id === selectedAthlete)
      ? selectedAthlete
      : athletes[0]?.id ?? "all";

  const [showHistory, setShowHistory] = useState(false);

  const filtered = useMemo(
    () =>
      effectiveSelected === "all"
        ? plans
        : plans.filter((p) => p.athleteId === effectiveSelected),
    [plans, effectiveSelected],
  );

  const active = filtered.filter((p) => p.status === "active");
  const benched = filtered.filter((p) => p.status === "benched");

  const subtitleNames =
    effectiveSelected === "all"
      ? athletes.map((a) => a.name.split(" ")[0]).join(" & ")
      : athletes.find((a) => a.id === effectiveSelected)?.name.split(" ")[0] ?? "";

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

      {athletes.length > 1 ? (
        <div className="mt-6 -mx-1 flex flex-wrap gap-2">
          <AthleteChip
            label="All"
            active={effectiveSelected === "all"}
            onClick={() => setSelectedAthlete("all")}
          />
          {athletes.map((a) => (
            <AthleteChip
              key={a.id}
              label={a.name.split(" ")[0]}
              active={effectiveSelected === a.id}
              onClick={() => setSelectedAthlete(a.id)}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {isLoading ? (
          <p className="py-5 text-center text-sm text-text-secondary">Loading…</p>
        ) : active.length === 0 ? (
          <EmptyCard />
        ) : (
          active.map((p) => (
            <PlanCard
              key={p.id}
              to="/parent/plans/$planId"
              planId={p.id}
              title={p.title}
              athleteName={
                effectiveSelected === "all" && athletes.length > 1
                  ? `${p.athleteName} · Coach ${p.coachName}`
                  : `Coach ${p.coachName}`
              }
              sessionsByState={p.sessionsByState}
              sessionsTotal={p.sessionsTotal}
            />
          ))
        )}
      </div>

      {benched.length > 0 ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            className="text-[11px] font-black uppercase tracking-widest text-text-secondary hover:text-text-primary"
          >
            {showHistory ? "Hide" : "Show"} past plans ({benched.length})
          </button>
          {showHistory ? (
            <div className="mt-4 space-y-3">
              {benched.map((p) => (
                <PlanCard
                  key={p.id}
                  to="/parent/plans/$planId"
                  planId={p.id}
                  title={p.title}
                  athleteName={
                    effectiveSelected === "all" && athletes.length > 1
                      ? `${p.athleteName} · Coach ${p.coachName}`
                      : `Coach ${p.coachName}`
                  }
                  sessionsByState={p.sessionsByState}
                  sessionsTotal={p.sessionsTotal}
                  muted
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <ParentBottomNav />
    </div>
  );
}

function AthleteChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-4 py-1.5 text-sm font-bold transition-colors",
        active
          ? "border-accent bg-accent text-accent-foreground"
          : "border-divider bg-card text-text-secondary hover:text-text-primary",
      )}
    >
      {label}
    </button>
  );
}

function EmptyCard() {
  return (
    <div className="rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
      <p className="font-hand text-2xl text-text-secondary">
        No plans yet — your coach will share one here.
      </p>
    </div>
  );
}
