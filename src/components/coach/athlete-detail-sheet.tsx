import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, RefreshCw, Sparkles, TrendingUp, Minus, TrendingDown } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PlanCard } from "@/components/plans/plan-card";
import { AlsoCoachedByList } from "@/components/coach/also-coached-by-list";
import { OtherCoachPlansSheet } from "@/components/coach/other-coach-plans-sheet";
import { cn } from "@/lib/utils";
import {
  getCoachAthleteDetail,
  getCoachAthleteAiSummary,
  type Verdict,
} from "@/lib/coach-athlete-detail.functions";
import { useCoachProfile } from "@/hooks/use-coach-profile";



export function AthleteDetailSheet({
  athleteId,
  onOpenChange,
}: {
  athleteId: string | null;
  onOpenChange: (next: string | null) => void;
}) {
  const open = athleteId !== null;
  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onOpenChange(null);
      }}
    >
      <SheetContent
        side="bottom"
        className="paper-surface max-h-[90dvh] overflow-y-auto border-t border-divider shadow-page"
      >
        {open ? <AthleteDetailBody athleteId={athleteId!} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function AthleteDetailBody({ athleteId }: { athleteId: string }) {
  const fetchDetail = useServerFn(getCoachAthleteDetail);
  const fetchSummary = useServerFn(getCoachAthleteAiSummary);
  const [openOtherCoachId, setOpenOtherCoachId] = useState<string | null>(null);
  const profile = useCoachProfile();
  const effectiveTier = profile.data?.profile.effectiveTier;
  const canViewOtherCoachPlans =
    effectiveTier === "coach_pro" || effectiveTier === "club";


  const detail = useQuery({
    queryKey: ["coach", "athlete-detail", athleteId],
    queryFn: () => fetchDetail({ data: { athleteId } }),
  });

  const summary = useQuery({
    queryKey: ["coach", "athlete-ai-summary", athleteId],
    queryFn: () => fetchSummary({ data: { athleteId } }),
    enabled: false,
    staleTime: 5 * 60_000,
    retry: false,
  });


  // Auto-run AI summary once we know there's at least some signal.
  useEffect(() => {
    if (detail.data?.hasAnySignal && !summary.data && !summary.isFetching) {
      summary.refetch();
    }
  }, [detail.data?.hasAnySignal, summary]);

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <div className="py-10 text-center text-sm text-text-secondary">
        Couldn't load athlete:{" "}
        {detail.error instanceof Error ? detail.error.message : "unknown error"}
      </div>
    );
  }

  const d = detail.data;
  const fullName = `${d.firstName} ${d.lastName}`.trim();
  const parentName = d.selfManaged
    ? null
    : `${d.parentFirstName ?? ""} ${d.parentLastName ?? ""}`.trim();

  return (
    <div className="space-y-6">
      <SheetHeader className="text-left">
        <SheetTitle className="font-display text-2xl font-black tracking-tight text-text-primary">
          {fullName}
        </SheetTitle>
        <p className="text-xs text-text-tertiary">
          {d.selfManaged ? "Adult athlete (self-managed)" : `Parent: ${parentName}`}
        </p>
      </SheetHeader>

      {/* Goals */}
      <section>
        <SectionHeading>
          {d.selfManaged ? "GOALS FROM ATHLETE" : "GOALS FROM PARENT & ATHLETE"}
        </SectionHeading>
        {d.goals.length === 0 ? (
          <EmptyLine>
            {d.coachedSports.length > 0
              ? `${d.firstName} hasn't set goals for ${formatSportList(d.coachedSports.map((s) => s.label))} yet.`
              : d.selfManaged
                ? `${d.firstName} hasn't set goals yet.`
                : `${d.parentFirstName ?? d.firstName} hasn't set goals yet.`}
          </EmptyLine>

        ) : (
          <ul className="mt-2 space-y-3">
            {d.goals.map((g) => (
              <li
                key={g.sport}
                className="rounded-xl border border-divider bg-card p-3"
              >
                <div className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
                  {g.sportLabel}
                </div>
                <div className="mt-1 flex items-baseline gap-2 text-sm">
                  <span className="font-bold text-text-primary">
                    {g.currentLevelLabel}
                  </span>
                  <span className="text-text-tertiary">→</span>
                  <span className="font-bold text-text-primary">
                    {g.seasonGoalLabel}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
                    this season
                  </span>
                </div>
                {g.longTermGoal ? (
                  <p className="mt-2 text-sm text-text-secondary">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
                      Long-term
                    </span>
                    <br />
                    {g.longTermGoal}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AI Summary */}
      <section>
        <div className="flex items-center justify-between">
          <SectionHeading>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Last {d.windowDays} days
            </span>
          </SectionHeading>
          <button
            type="button"
            onClick={() => summary.refetch()}
            disabled={summary.isFetching || !d.hasAnySignal}
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-text-tertiary hover:text-text-primary disabled:opacity-40"
          >
            <RefreshCw
              className={cn("h-3 w-3", summary.isFetching && "animate-spin")}
            />
            Refresh
          </button>
        </div>

        <div className="mt-2 rounded-xl border border-divider bg-card p-4">
          <ActivityCounts
            practiceMinutesTotal={d.activity.practiceMinutesTotal}
            lessonMinutesTotal={d.activity.lessonMinutesTotal}
          />

          {!d.hasAnySignal ? (
            <p className="mt-3 text-sm text-text-secondary">
              No practice or lessons in the last {d.windowDays} days.
            </p>
          ) : summary.isFetching && !summary.data ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-text-tertiary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading practice logs and messages…
            </div>
          ) : summary.error ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-text-secondary">
                Couldn't generate summary right now.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => summary.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : summary.data ? (
            <>
              <p className="mt-3 text-sm leading-relaxed text-text-primary">
                {summary.data.summary}
              </p>
              {!summary.data.empty ? (
                <VerdictPill
                  verdict={summary.data.verdict}
                  rationale={summary.data.rationale}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </section>

      {/* Plans */}
      <section className="pb-2">
        <SectionHeading>Plans</SectionHeading>
        {d.plans.length === 0 ? (
          <EmptyLine>No active or benched plans for {d.firstName} yet.</EmptyLine>
        ) : (
          <PlansList plans={d.plans} />
        )}
      </section>

      {/* Also coached by */}
      <AlsoCoachedByList
        coaches={d.otherCoaches}
        onOpenCoach={setOpenOtherCoachId}
        locked={!canViewOtherCoachPlans}
      />

      {canViewOtherCoachPlans ? (
        <OtherCoachPlansSheet
          coach={
            d.otherCoaches.find((c) => c.coachId === openOtherCoachId) ?? null
          }
          athleteFirstName={d.firstName}
          onOpenChange={(v) => {
            if (!v) setOpenOtherCoachId(null);
          }}
        />
      ) : null}
    </div>
  );
}



function formatSportList(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
      {children}
    </h3>
  );
}

type PlanRow = {
  planId: string;
  title: string;
  status: string;
  sessionsByState: React.ComponentProps<typeof PlanCard>["sessionsByState"];
  sessionsTotal: number;
};

function PlanRowCard({ p }: { p: PlanRow }) {
  return (
    <PlanCard
      to="/coach/plans/$planId"
      planId={p.planId}
      title={p.title}
      sessionsByState={p.sessionsByState}
      sessionsTotal={p.sessionsTotal}
      edgeTone={p.status === "active" ? "active" : "muted"}
    />
  );
}

function PlansList({ plans }: { plans: PlanRow[] }) {
  const active = plans.filter((p) => p.status === "active");
  const benched = plans.filter((p) => p.status !== "active");
  const [benchedOpen, setBenchedOpen] = useState(false);

  return (
    <div className="mt-2 space-y-4">
      {active.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
            Active
          </div>
          <div className="space-y-3">
            {active.map((p) => (
              <PlanRowCard key={p.planId} p={p} />
            ))}
          </div>
        </div>
      ) : null}

      {benched.length > 0 ? (
        <Collapsible open={benchedOpen} onOpenChange={setBenchedOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
            <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
              Benched ({benched.length})
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-text-tertiary transition-transform",
                benchedOpen && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-3">
            {benched.map((p) => (
              <PlanRowCard key={p.planId} p={p} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded-xl border border-dashed border-divider bg-card/40 px-3 py-4 text-sm text-text-tertiary">
      {children}
    </p>
  );
}

function ActivityCounts({
  practiceMinutesTotal,
  lessonMinutesTotal,
}: {
  practiceMinutesTotal: number;
  lessonMinutesTotal: number;
}) {
  const fmt = (mins: number) => (mins / 60).toFixed(1);
  return (
    <div className="grid grid-cols-2 gap-3 border-b border-divider/60 pb-3">
      <div>
        <div className="font-display text-xl font-black tabular-nums text-text-primary">
          {fmt(practiceMinutesTotal)}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
          Total practice hrs
        </div>
      </div>
      <div>
        <div className="font-display text-xl font-black tabular-nums text-text-primary">
          {fmt(lessonMinutesTotal)}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
          Total lesson hrs
        </div>
      </div>
    </div>
  );
}


function VerdictPill({
  verdict,
  rationale,
}: {
  verdict: Verdict;
  rationale: string;
}) {
  const config = {
    increase: {
      label: "Increase challenge",
      Icon: TrendingUp,
      tone: "text-[var(--pen-tennis)]",
      bg: "bg-[var(--pen-tennis)]/10 border-[var(--pen-tennis)]/30",
    },
    hold: {
      label: "Hold steady",
      Icon: Minus,
      tone: "text-text-primary",
      bg: "bg-elevated border-divider",
    },
    reduce: {
      label: "Ease off",
      Icon: TrendingDown,
      tone: "text-[var(--pen-pool)]",
      bg: "bg-[var(--pen-pool)]/10 border-[var(--pen-pool)]/30",
    },
  }[verdict];
  const Icon = config.Icon;
  return (
    <div className={cn("mt-3 rounded-xl border p-3", config.bg)}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", config.tone)} />
        <span className={cn("text-sm font-black uppercase tracking-wider", config.tone)}>
          {config.label}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
        {rationale}
      </p>
    </div>
  );
}
