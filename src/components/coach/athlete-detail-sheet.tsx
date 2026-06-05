import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Sparkles, TrendingUp, Minus, TrendingDown } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PlanCard } from "@/components/plans/plan-card";
import { cn } from "@/lib/utils";
import {
  getCoachAthleteDetail,
  getCoachAthleteAiSummary,
  type Verdict,
} from "@/lib/coach-athlete-detail.functions";

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
        className="max-h-[90vh] overflow-y-auto border-t border-divider shadow-page"
        style={{ backgroundColor: "var(--popover)", backgroundImage: "none" }}
      >
        {open ? <AthleteDetailBody athleteId={athleteId!} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function AthleteDetailBody({ athleteId }: { athleteId: string }) {
  const fetchDetail = useServerFn(getCoachAthleteDetail);
  const fetchSummary = useServerFn(getCoachAthleteAiSummary);

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
  const parentName = `${d.parentFirstName} ${d.parentLastName}`.trim();

  return (
    <div className="space-y-6">
      <SheetHeader className="text-left">
        <SheetTitle className="font-display text-2xl font-black tracking-tight text-text-primary">
          {fullName}
        </SheetTitle>
        <p className="text-xs text-text-tertiary">
          Parent: {parentName}
        </p>
      </SheetHeader>

      {/* Goals */}
      <section>
        <SectionHeading>Goals from parent</SectionHeading>
        {d.goals.length === 0 ? (
          <EmptyLine>
            {d.parentFirstName} hasn't set goals yet.
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
            sessions={d.activity.sessions}
            minutes={d.activity.practiceMinutes}
            messages={d.activity.messagesFromAthleteOrParent}
          />

          {!d.hasAnySignal ? (
            <p className="mt-3 text-sm text-text-secondary">
              No practice logs or messages yet in the last {d.windowDays} days.
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
          <div className="mt-2 space-y-3">
            {d.plans.map((p) => (
              <div key={p.planId}>
                <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-text-tertiary">
                  {p.status === "active" ? "Active" : "Benched"}
                </div>
                <PlanCard
                  to="/coach/plans/$planId"
                  planId={p.planId}
                  title={p.title}
                  sessionsByState={p.sessionsByState}
                  sessionsTotal={p.sessionsTotal}
                  edgeTone={p.status === "active" ? "active" : "muted"}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
      {children}
    </h3>
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
  sessions,
  minutes,
  messages,
}: {
  sessions: number;
  minutes: number;
  messages: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 border-b border-divider/60 pb-3">
      <Stat value={sessions} label={sessions === 1 ? "Practice" : "Practices"} />
      <Stat value={minutes} label="Minutes" />
      <Stat value={messages} label={messages === 1 ? "Message" : "Messages"} />
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="font-display text-xl font-black tabular-nums text-text-primary">
        {value}
      </div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
        {label}
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
