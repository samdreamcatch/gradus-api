import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ChevronDown, MessageCircle, Pause, Play, RotateCcw, Settings, X } from "lucide-react";
import { toast } from "sonner";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { cn } from "@/lib/utils";
import {
  getParentPlan,
  type ParentPlanMoveDTO,
} from "@/lib/parent-plans.functions";

export const Route = createFileRoute("/_authenticated/parent/plans/$planId")({
  component: ParentPlanDetail,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link
        to="/parent/plans"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" /> Back
      </Link>
      <div className="mt-6 rounded-2xl border border-divider bg-card p-6 text-sm text-text-secondary">
        Couldn&apos;t load this plan: {error.message}
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-text-secondary">
      Plan not found.
    </div>
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

  const soon = (label: string) => toast(`${label} — coming soon`);

  if (isLoading || !plan) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center text-sm text-text-secondary">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-32">
      <div className="flex items-center justify-between">
        <Link
          to="/parent/plans"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
        <button
          type="button"
          onClick={() => soon("Settings")}
          className="text-text-tertiary hover:text-text-primary"
          aria-label="Settings"
        >
          <Settings className="size-5" />
        </button>
      </div>

      <div className="mt-8">
        <p className="text-sm font-medium text-text-secondary">
          {plan.athleteFirstName} · Coach {plan.coachName}
        </p>
        <h1 className="mt-1 font-display text-4xl font-black leading-[1.05] tracking-tight text-text-primary">
          {plan.title}
        </h1>
      </div>

      <SessionTimer onSlide={() => soon("Slide mode")} />


      <p className="mt-8 text-[11px] font-black uppercase tracking-widest text-text-secondary">
        From the Coach
      </p>

      <div className="mt-3 space-y-3">
        {plan.moves.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-divider bg-card p-6 text-center">
            <p className="font-hand text-xl text-text-secondary">
              No moves in this plan yet.
            </p>
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

      <div className="mt-10 flex justify-center">
        <button
          type="button"
          onClick={() => soon(`Message ${plan.coachFirstName}`)}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-bold text-accent-foreground shadow-card"
        >
          <MessageCircle className="size-4" />
          Message {plan.coachFirstName} about this plan
        </button>
      </div>

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
  const [shown, setShown] = useState<{ cue: boolean; why: boolean }>({
    cue: false,
    why: false,
  });
  const show = (kind: "cue" | "why") => setShown((s) => ({ ...s, [kind]: true }));
  const hide = (kind: "cue" | "why") => setShown((s) => ({ ...s, [kind]: false }));

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
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <span className="flex shrink-0 items-baseline gap-1 tabular-nums">
          <span className="font-display text-lg font-black text-text-primary">
            {move.targetValue}
          </span>
          <span className="text-xs text-text-tertiary">{unit}</span>
        </span>
        <span className="flex-1 font-display text-lg text-text-primary">
          {move.name}
        </span>
        <ChevronDown
          className={cn(
            "size-5 shrink-0 text-text-tertiary transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded ? (
        <div className="space-y-3 px-4 pb-4">
          {move.description ? (
            <p className="text-[15px] leading-relaxed text-text-primary">
              {move.description}
            </p>
          ) : null}

          {shown.cue && move.cue ? (
            <CoachNote
              label="How to cue this"
              body={move.cue}
              onClose={() => hide("cue")}
            />
          ) : null}
          {shown.why && move.why ? (
            <CoachNote
              label="Why it's assigned"
              body={move.why}
              onClose={() => hide("why")}
            />
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!shown.cue && move.cue ? (
              <button
                type="button"
                onClick={() => show("cue")}
                className="rounded-full border border-accent/60 bg-card px-3 py-1.5 text-xs font-bold text-accent-ink hover:bg-accent/10"
              >
                How do I cue this?
              </button>
            ) : null}
            {!shown.why && move.why ? (
              <button
                type="button"
                onClick={() => show("why")}
                className="rounded-full border border-accent/60 bg-card px-3 py-1.5 text-xs font-bold text-accent-ink hover:bg-accent/10"
              >
                Why is this assigned?
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CoachNote({
  label,
  body,
  onClose,
}: {
  label: string;
  body: string;
  onClose: () => void;
}) {
  return (
    <div className="relative rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 pr-9">
      <p className="text-[10px] font-black uppercase tracking-widest text-accent-ink">
        {label}
      </p>
      <p className="mt-1 text-[15px] leading-relaxed text-text-primary">
        {body}
      </p>
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
