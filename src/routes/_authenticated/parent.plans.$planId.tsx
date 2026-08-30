import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, MessageCircle, X } from "lucide-react";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { cn } from "@/lib/utils";
import { getParentPlan, type ParentPlanMoveDTO } from "@/lib/parent-plans.functions";
import { MessageCoachAboutPlanDialog } from "@/components/plans/message-coach-about-plan-dialog";
import { PlanSessionTimer } from "@/components/plans/plan-session-timer";
import { ShareToSocialsButton } from "@/components/plans/share-to-socials-button";
import { FlowStateBars } from "@/components/plans/flow-state-bars";
import { getPlanSessions, listPlanSessions } from "@/lib/plan-sessions.functions";
import { Eyebrow } from "@/components/ui/eyebrow";
import { SettingsList, SettingsRow, SettingsButtonRow } from "@/components/settings/primitives";
import {
  sessionAttributionLine,
  sessionLoggerLabel,
  sessionMetaLabel,
  stateLabel,
} from "@/lib/session-states";

import { PlansRouteError } from "@/components/plans/plans-error";


export const Route = createFileRoute("/_authenticated/parent/plans/$planId")({
  component: ParentPlanDetail,
  loader: ({ params, context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["parent-plan", params.planId],
      queryFn: () => getParentPlan({ data: { id: params.planId } }),
    }),
  errorComponent: ({ error }) => (
    <PlansRouteError error={error} label="Couldn't load this plan" backTo="/parent/plans" />
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-3 py-8 text-sm text-text-secondary">Plan not found.</div>
  ),
});

function ParentPlanDetail() {
  const { planId } = Route.useParams();
  const fetchPlan = useServerFn(getParentPlan);
  const { data, isLoading } = useQuery({
    queryKey: ["parent-plan", planId],
    queryFn: () => fetchPlan({ data: { id: planId } }),
  });

  const plan = data?.plan;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((s) => ({ ...s, [id]: !s[id] }));
  const [messageOpen, setMessageOpen] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);

  const fetchPlanSessions = useServerFn(getPlanSessions);
  const sessionsQuery = useQuery({
    queryKey: ["plan-sessions", planId],
    queryFn: () => fetchPlanSessions({ data: { planId } }),
  });
  const fetchPlanSessionLog = useServerFn(listPlanSessions);
  const sessionLogQuery = useQuery({
    queryKey: ["plan-session-log", planId],
    queryFn: () => fetchPlanSessionLog({ data: { planId } }),
  });
  const log = sessionLogQuery.data;


  if (isLoading || !plan) {
    return (
      <div className="mx-auto max-w-2xl px-3 py-8 text-center text-sm text-text-secondary">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-3 pt-3 pb-app-chrome">
      <div className="flex items-center justify-between">
        <Link
          to="/parent/plans"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
        <ShareToSocialsButton planId={plan.id} planTitle={plan.title} />
      </div>

      <div className="mt-4">
        <p className="text-[12px] font-medium text-text-secondary text-center">
          {plan.athleteFirstName} · {plan.isGradus ? "from Gradus" : `Coach ${plan.coachName}`}
        </p>
        <h1 className="mt-0.5 font-display leading-[0.95] tracking-tight text-text-primary font-medium text-2xl text-center">
          {plan.title}
        </h1>
      </div>

      <PlanSessionTimer
        role="parent"
        planId={plan.id}
        coachFirstName={plan.coachFirstName}
        athleteFirstName={plan.athleteFirstName}
        planTitle={plan.title}
      />

      <p className="mt-5 text-[11px] font-black uppercase tracking-widest text-text-secondary">
        {plan.isGradus ? "From Gradus" : "From the Coach"}
      </p>

      <div className="mt-2 space-y-1.5">
        {plan.moves.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-divider bg-card p-4 text-center">
            <p className="font-hand text-xl text-text-secondary">No moves in this plan yet.</p>
          </div>
        ) : (
          plan.moves.map((m) => (
            <MoveCard
              key={m.id}
              move={m}
              expanded={!!expanded[m.id]}
              onToggle={() => toggle(m.id)}
            />
          ))
        )}
      </div>

      <div className="mt-5 rounded-lg border border-divider bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Eyebrow as="span" size="micro" tone="tertiary" weight="black">
            Logged instances
          </Eyebrow>
          <span className="text-xs text-text-tertiary tabular-nums">
            {sessionsQuery.data?.sessionsTotal ?? 0} session
            {(sessionsQuery.data?.sessionsTotal ?? 0) === 1 ? "" : "s"}
          </span>
        </div>
        <FlowStateBars
          counts={
            sessionsQuery.data?.sessionsByState ?? {
              frustrated: 0,
              pushing: 0,
              steady: 0,
              lockedIn: 0,
              flowing: 0,
            }
          }
        />

        {log && log.total > 0 ? (
          <p className="mt-2 text-xs text-text-tertiary">
            {sessionAttributionLine({
              total: log.total,
              loggedByAthlete: log.loggedByAthlete,
              loggedByParent: log.loggedByParent,
              athleteFirstName: log.athleteFirstName,
            })}
          </p>
        ) : null}

        {log && log.sessions.length > 0 ? (
          <div className="mt-4 border-t border-dashed border-divider pt-3">
            <Eyebrow as="p" size="micro" tone="tertiary" weight="black" className="mb-2">
              Practice log
            </Eyebrow>
            <SettingsList>
              {(showAllSessions ? log.sessions : log.sessions.slice(0, 5)).map((s) => (
                <SettingsRow
                  key={s.id}
                  label={sessionLoggerLabel(
                    s.loggedByKind,
                    s.loggedByFirstName,
                    log.athleteFirstName,
                  )}
                  description={
                    s.note ? `${stateLabel(s.stateIndex)} · ${s.note}` : stateLabel(s.stateIndex)
                  }
                  value={sessionMetaLabel(s.loggedAt, s.durationSeconds)}
                />
              ))}
              {!showAllSessions && log.sessions.length > 5 ? (
                <SettingsButtonRow
                  label={`Show all ${log.sessions.length}`}
                  tone="accent"
                  onClick={() => setShowAllSessions(true)}
                />
              ) : null}
            </SettingsList>
          </div>
        ) : (
          <p className="mt-3 text-xs text-text-tertiary">
            No practice logged yet. Sessions you or {plan.athleteFirstName} log will show up here.
          </p>
        )}
      </div>



      {plan.isGradus ? null : (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => setMessageOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-bold text-accent-foreground shadow-card"
          >
            <MessageCircle className="size-4" />
            Message {plan.coachFirstName} about this plan
          </button>
        </div>
      )}

      <MessageCoachAboutPlanDialog
        open={messageOpen}
        onOpenChange={setMessageOpen}
        coachId={plan.coachId}
        athleteId={plan.athleteId}
        coachFirstName={plan.coachFirstName}
        planId={plan.id}
        planTitle={plan.title}
        messagesBasePath="/parent/messages"
      />

      <ParentBottomNav />
    </div>
  );
}

function MoveCard({
  move,
  expanded,
  onToggle,
}: {
  move: ParentPlanMoveDTO;
  expanded: boolean;
  onToggle: () => void;
}) {
  const unit = move.targetKind === "mins" ? "min" : "reps";
  const hasCue = Boolean(move.cue);
  const hasDescription = Boolean(move.description);
  const hasBoth = hasCue && hasDescription;
  const [view, setView] = useState<"how" | "what">(hasCue ? "how" : "what");
  const [whyShown, setWhyShown] = useState(false);

  const bodyText =
    view === "how" && hasCue ? move.cue : hasDescription ? move.description : move.cue;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card shadow-card transition-colors",
        expanded ? "border-accent" : "border-divider",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3.5 py-2 text-left"
        aria-expanded={expanded}
      >
        <span className="flex shrink-0 items-baseline gap-1 tabular-nums">
          <span className="font-display text-[18px] font-black text-text-primary">
            {move.targetValue}
          </span>
          <span className="text-[11px] text-text-tertiary">{unit}</span>
        </span>
        <span className="flex-1 font-display text-[15px] text-text-primary">{move.name}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-text-tertiary transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded ? (
        <div className="space-y-2 px-3.5 pb-3">
          {hasBoth ? <HowWhatToggle value={view} onChange={setView} /> : null}

          {bodyText ? (
            <p
              role={hasBoth ? "tabpanel" : undefined}
              className="text-[15px] leading-relaxed text-text-primary"
            >
              {bodyText}
            </p>
          ) : null}

          {whyShown && move.why ? (
            <CoachNote
              label="Why it's assigned"
              body={move.why}
              onClose={() => setWhyShown(false)}
            />
          ) : null}

          {!whyShown && move.why ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setWhyShown(true)}
                className="rounded-full border border-accent/60 bg-card px-3 py-1.5 text-xs font-bold text-accent-ink hover:bg-accent/10"
              >
                Why is this assigned?
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HowWhatToggle({
  value,
  onChange,
}: {
  value: "how" | "what";
  onChange: (v: "how" | "what") => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Move detail view"
      className="inline-flex rounded-full border border-divider bg-card p-0.5"
    >
      {(["how", "what"] as const).map((v) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(v)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-bold transition-colors",
              active
                ? "border border-accent/60 bg-accent/10 text-accent-ink"
                : "border border-transparent text-text-tertiary",
            )}
          >
            {v === "how" ? "Cue" : "Description"}
          </button>
        );
      })}
    </div>
  );
}

function CoachNote({ label, body, onClose }: { label: string; body: string; onClose: () => void }) {
  return (
    <div className="relative rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 pr-9">
      <p className="text-[10px] font-black uppercase tracking-widest text-accent-ink">{label}</p>
      <p className="mt-1 text-[15px] leading-relaxed text-text-primary">{body}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Hide ${label}`}
        className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full text-text-tertiary hover:bg-card hover:text-text-primary"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
