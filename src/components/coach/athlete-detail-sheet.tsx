import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Minus,
  TrendingDown,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { PlanCard } from "@/components/plans/plan-card";
import { AlsoCoachedByList } from "@/components/coach/also-coached-by-list";
import { OtherCoachPlansSheet } from "@/components/coach/other-coach-plans-sheet";
import { AthleteBillingSection } from "@/components/coach/athlete-billing-section";

import { cn } from "@/lib/utils";
import {
  getCoachAthleteDetail,
  getCoachAthleteAiSummary,
  type Verdict,
  type AthletePracticeTargetDTO,
} from "@/lib/coach-athlete-detail.functions";
import { adoptStarterPlan } from "@/lib/starter-programs.functions";
import { setPracticeTarget, clearPracticeTarget } from "@/lib/practice-targets.functions";
import { useCoachProfile } from "@/hooks/use-coach-profile";
import {
  buildSampleAiSummary,
  buildSampleAthleteDetail,
  isSampleAthlete,
  SAMPLE_SESSION_FEEDBACK,
} from "@/data/sample-athlete";

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
  const canViewOtherCoachPlans = effectiveTier === "club";

  const isSample = isSampleAthlete(athleteId);

  const detail = useQuery({
    queryKey: ["coach", "athlete-detail", athleteId],
    queryFn: () => fetchDetail({ data: { athleteId } }),
    enabled: !isSample,
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
    if (isSample) return;
    if (detail.data?.hasAnySignal && !summary.data && !summary.isFetching) {
      summary.refetch();
    }
  }, [detail.data?.hasAnySignal, summary]);

  if (isSample) {
    return (
      <SampleAthleteBody
        athleteId={athleteId}
        showBilling={effectiveTier === "coach_pro" || effectiveTier === "club"}
      />
    );
  }

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
              <li key={g.sport} className="rounded-xl border border-divider bg-card p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
                  {g.sportLabel}
                </div>
                <div className="mt-1 flex items-baseline gap-2 text-sm">
                  <span className="font-bold text-text-primary">{g.currentLevelLabel}</span>
                  <span className="text-text-tertiary">→</span>
                  <span className="font-bold text-text-primary">{g.seasonGoalLabel}</span>
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

      {/* Practice expectations */}
      {d.practiceTargets.length > 0 ? (
        <section>
          <SectionHeading>PRACTICE EXPECTATIONS</SectionHeading>
          <p className="mt-1 text-xs text-text-tertiary">
            What {d.firstName} should practice on their own each week. Starts from the Gradus
            default for their level.
          </p>
          <div className="mt-2 space-y-2">
            {d.practiceTargets.map((t) => (
              <PracticeTargetRow key={t.sport} athleteId={athleteId} target={t} />
            ))}
          </div>
        </section>
      ) : null}

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
            <RefreshCw className={cn("h-3 w-3", summary.isFetching && "animate-spin")} />
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
              <p className="text-sm text-text-secondary">Couldn't generate summary right now.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => summary.refetch()}>
                Try again
              </Button>
            </div>
          ) : summary.data ? (
            <>
              <p className="mt-3 text-sm leading-relaxed text-text-primary">
                {summary.data.summary}
              </p>
              {!summary.data.empty ? (
                <VerdictPill verdict={summary.data.verdict} rationale={summary.data.rationale} />
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

      {/* Competition results (private to this athlete's circle) */}
      <CompetitionResultsSection athleteId={athleteId} firstName={d.firstName} />


      {/* Billing (Coach Pro & Club) */}
      {effectiveTier === "coach_pro" || effectiveTier === "club" ? (
        <AthleteBillingSection athleteId={athleteId} />
      ) : null}

      {/* Also coached by */}
      <AlsoCoachedByList
        coaches={d.otherCoaches}
        onOpenCoach={setOpenOtherCoachId}
        locked={!canViewOtherCoachPlans}
        unlockedCoachIds={d.sharedCoachIds}
        visibility={d.coachVisibility}
        askName={d.selfManaged ? d.firstName : d.parentFirstName}
      />

      {canViewOtherCoachPlans || d.sharedCoachIds.length > 0 ? (
        <OtherCoachPlansSheet
          coach={d.otherCoaches.find((c) => c.coachId === openOtherCoachId) ?? null}
          athleteFirstName={d.firstName}
          onOpenChange={(v) => {
            if (!v) setOpenOtherCoachId(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Read-only rendering of the sample athlete — same sections, fixture data. */
function SampleAthleteBody({
  athleteId,
  showBilling,
}: {
  athleteId: string;
  showBilling: boolean;
}) {
  const d = buildSampleAthleteDetail();
  const summary = buildSampleAiSummary();
  const g = d.goals[0];

  return (
    <div className="space-y-6">
      <SheetHeader className="text-left">
        <SheetTitle className="font-display text-2xl font-black tracking-tight text-text-primary">
          {d.firstName} {d.lastName}
        </SheetTitle>
        <p className="text-xs text-text-tertiary">
          Sample athlete · Parent: {d.parentFirstName} {d.parentLastName}
        </p>
      </SheetHeader>

      <section>
        <SectionHeading>GOALS FROM PARENT &amp; ATHLETE</SectionHeading>
        <ul className="mt-2 space-y-3">
          <li className="rounded-xl border border-divider bg-card p-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
              {g.sportLabel}
            </div>
            <div className="mt-1 flex items-baseline gap-2 text-sm">
              <span className="font-bold text-text-primary">{g.currentLevelLabel}</span>
              <span className="text-text-tertiary">→</span>
              <span className="font-bold text-text-primary">{g.seasonGoalLabel}</span>
              <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
                this season
              </span>
            </div>
            <p className="mt-2 text-sm text-text-secondary">
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
                Long-term
              </span>
              <br />
              {g.longTermGoal}
            </p>
          </li>
        </ul>
      </section>

      <section>
        <SectionHeading>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Last {d.windowDays} days
          </span>
        </SectionHeading>
        <div className="mt-2 rounded-xl border border-divider bg-card p-4">
          <ActivityCounts
            practiceMinutesTotal={d.activity.practiceMinutesTotal}
            lessonMinutesTotal={d.activity.lessonMinutesTotal}
          />
          <p className="mt-3 text-sm leading-relaxed text-text-primary">{summary.summary}</p>
          <VerdictPill verdict={summary.verdict} rationale={summary.rationale} />
        </div>
      </section>

      <section>
        <SectionHeading>Plans</SectionHeading>
        <div className="mt-2">
          <PlanCard
            planId={d.plans[0].planId}
            title={d.plans[0].title}
            athleteName="from Gradus"
            sessionsByState={d.plans[0].sessionsByState}
            sessionsTotal={d.plans[0].sessionsTotal}
          />
        </div>
      </section>

      {showBilling ? <AthleteBillingSection athleteId={athleteId} /> : null}

      <section className="pb-2">
        <SectionHeading>Session feedback</SectionHeading>
        <ul className="mt-2 space-y-2">
          {SAMPLE_SESSION_FEEDBACK.map((s) => (
            <li key={s.daysAgo} className="rounded-xl border border-divider bg-card p-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
                {s.daysAgo === 1 ? "Yesterday" : `${s.daysAgo} days ago`}
              </div>
              <p className="mt-1 text-sm text-text-secondary">{s.note}</p>
            </li>
          ))}
        </ul>
      </section>
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
  isGradus: boolean;
  sessionsByState: React.ComponentProps<typeof PlanCard>["sessionsByState"];
  sessionsTotal: number;
};

function PlanRowCard({ p }: { p: PlanRow }) {
  const adopt = useServerFn(adoptStarterPlan);
  const queryClient = useQueryClient();
  const adoptMutation = useMutation({
    mutationFn: () => adopt({ data: { planId: p.planId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coach", "athlete-detail"] });
    },
  });

  return (
    <div className="space-y-1.5">
      <PlanCard
        to="/coach/plans/$planId"
        planId={p.planId}
        title={p.title}
        athleteName={p.isGradus ? "from Gradus" : undefined}
        sessionsByState={p.sessionsByState}
        sessionsTotal={p.sessionsTotal}
        edgeTone={p.status === "active" ? "active" : "muted"}
      />
      {p.isGradus ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="press h-8 rounded-full text-xs"
            disabled={adoptMutation.isPending}
            onClick={() => adoptMutation.mutate()}
          >
            {adoptMutation.isPending ? "Adopting…" : "Adopt plan"}
          </Button>
        </div>
      ) : null}
    </div>
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

function VerdictPill({ verdict, rationale }: { verdict: Verdict; rationale: string }) {
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
      <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">{rationale}</p>
    </div>
  );
}

/** One editable weekly practice expectation for an athlete in one sport. */
function PracticeTargetRow({
  athleteId,
  target,
}: {
  athleteId: string;
  target: AthletePracticeTargetDTO;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(setPracticeTarget);
  const reset = useServerFn(clearPracticeTarget);
  const [value, setValue] = useState(String(target.hoursPerWeek));

  useEffect(() => {
    setValue(String(target.hoursPerWeek));
  }, [target.hoursPerWeek]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["coach", "athlete-detail", athleteId] });
  };

  const saveMutation = useMutation({
    mutationFn: (hours: number) =>
      save({ data: { athleteId, sport: target.sport, hoursPerWeek: hours } }),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Couldn't save expectation"),
  });

  const resetMutation = useMutation({
    mutationFn: () => reset({ data: { athleteId, sport: target.sport } }),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Couldn't reset expectation"),
  });

  const commit = () => {
    const n = Number(value);
    const clamped = Math.max(0, Math.min(40, Number.isFinite(n) ? n : 0));
    setValue(String(clamped));
    if (clamped === target.hoursPerWeek) return;
    saveMutation.mutate(clamped);
  };

  const busy = saveMutation.isPending || resetMutation.isPending;

  return (
    <div className="rounded-xl border border-divider bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
            {target.sportLabel}
          </div>
          <div className="mt-0.5 text-sm text-text-secondary">
            {target.currentLevelLabel ?? "No level set yet"}
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            max={40}
            step={0.5}
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            className="h-9 w-16 px-2 text-right tabular-nums"
            aria-label={`Weekly practice hours for ${target.sportLabel}`}
          />
          <span className="text-xs text-text-tertiary">hrs/wk</span>
        </div>
      </div>
      {target.isOverride ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-text-tertiary">
            Custom — default is {target.defaultHoursPerWeek} hrs/wk
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => resetMutation.mutate()}
          >
            Reset to default
          </Button>
        </div>
      ) : null}
    </div>
  );
}
