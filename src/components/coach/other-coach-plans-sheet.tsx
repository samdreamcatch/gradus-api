import { useState } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import { MessageCoachAboutPlanDialog } from "@/components/plans/message-coach-about-plan-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type {
  OtherCoachDTO,
  OtherCoachMoveDTO,
  OtherCoachPlanDTO,
} from "@/lib/coach-athlete-detail.functions";

function relativeDay(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const days = Math.round((Date.now() - then) / 86400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months === 1) return "1mo ago";
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(days / 365);
  return years === 1 ? "1y ago" : `${years}y ago`;
}

export function OtherCoachPlansSheet({
  coach,
  athleteFirstName,
  onOpenChange,
}: {
  coach: OtherCoachDTO | null;
  athleteFirstName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const open = coach !== null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="paper-surface max-h-[90dvh] overflow-y-auto border-t border-divider shadow-page"
      >
        {coach ? <Body coach={coach} athleteFirstName={athleteFirstName} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({ coach, athleteFirstName }: { coach: OtherCoachDTO; athleteFirstName: string }) {
  const fullName = `${coach.firstName} ${coach.lastName}`.trim();
  return (
    <div className="space-y-5">
      <SheetHeader className="text-left">
        <p className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
          Also coaching {athleteFirstName}
        </p>
        <SheetTitle className="font-display text-2xl font-black tracking-tight text-text-primary">
          Coach {fullName}
        </SheetTitle>
        {coach.sports.length > 0 ? (
          <SheetDescription asChild>
            <div className="flex flex-wrap gap-1 pt-1">
              {coach.sports.map((s) => (
                <span
                  key={s.key}
                  className="rounded-pill border border-divider bg-elevated px-2 py-0.5 text-[11px] font-medium text-text-primary"
                >
                  {s.label}
                </span>
              ))}
            </div>
          </SheetDescription>
        ) : null}
      </SheetHeader>

      <ul className="space-y-3">
        {coach.plans.map((p) => (
          <li key={p.planId}>
            <PlanCard plan={p} otherCoachId={coach.coachId} coachFirstName={coach.firstName} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusPill({ status }: { status: "active" | "benched" }) {
  return status === "active" ? (
    <span className="inline-flex items-center rounded-pill border border-[var(--pen-tennis)]/40 bg-[var(--pen-tennis)]/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-[var(--pen-tennis-ink)]">
      Active
    </span>
  ) : (
    <span className="inline-flex items-center rounded-pill border border-divider bg-elevated px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-text-tertiary">
      Benched
    </span>
  );
}

function PlanCard({
  plan,
  otherCoachId,
  coachFirstName,
}: {
  plan: OtherCoachPlanDTO;
  otherCoachId: string;
  coachFirstName: string;
}) {
  const [messageOpen, setMessageOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-divider bg-card shadow-card">
      <div className="border-b border-divider/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 font-display text-lg font-black leading-tight tracking-tight text-text-primary">
            {plan.title}
          </h3>
          <StatusPill status={plan.status} />
        </div>
        <p className="mt-1 text-[11px] uppercase tracking-widest text-text-tertiary">
          Updated {relativeDay(plan.updatedAt)}
          {" · "}
          {plan.sessionsLast30d} {plan.sessionsLast30d === 1 ? "session" : "sessions"} in last 30d
        </p>
        {plan.notes.trim() ? (
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">{plan.notes}</p>
        ) : null}
      </div>

      <div className="p-3">
        <p className="px-1 pb-2 text-[10px] font-black uppercase tracking-widest text-text-tertiary">
          {plan.moves.length} {plan.moves.length === 1 ? "move" : "moves"}
        </p>
        {plan.moves.length === 0 ? (
          <p className="rounded-xl border border-dashed border-divider bg-card/40 px-3 py-4 text-sm text-text-tertiary">
            No moves in this plan yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {plan.moves.map((m) => (
              <MoveRow key={m.position} move={m} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-divider/60 p-3">
        <button
          type="button"
          onClick={() => setMessageOpen(true)}
          className="press inline-flex w-full items-center justify-center gap-2 rounded-xl border border-divider bg-elevated px-3 py-2 text-sm font-semibold text-text-primary"
        >
          <MessageCircle className="size-4" />
          Message about this plan
        </button>
      </div>

      <MessageCoachAboutPlanDialog
        mode="coach-direct"
        open={messageOpen}
        onOpenChange={setMessageOpen}
        otherCoachId={otherCoachId}
        coachFirstName={coachFirstName}
        planId={plan.planId}
        planTitle={plan.title}
      />
    </div>
  );
}

function MoveRow({ move }: { move: OtherCoachMoveDTO }) {
  const [open, setOpen] = useState(false);
  const unit = move.targetKind === "mins" ? "min" : "reps";
  const hasBody = Boolean(move.cue || move.description || move.why);
  return (
    <div
      className={cn(
        "rounded-xl border bg-elevated transition-colors",
        open ? "border-accent/60" : "border-divider",
      )}
    >
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2 text-left",
          hasBody ? "press-soft" : "cursor-default",
        )}
        aria-expanded={open}
        disabled={!hasBody}
      >
        <span className="flex shrink-0 items-baseline gap-1 tabular-nums">
          <span className="font-display text-[16px] font-black text-text-primary">
            {move.targetValue}
          </span>
          <span className="text-[10px] text-text-tertiary">{unit}</span>
        </span>
        <span className="min-w-0 flex-1 truncate font-display text-[14px] text-text-primary">
          {move.name}
        </span>
        {hasBody ? (
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-text-tertiary transition-transform",
              open && "rotate-180",
            )}
          />
        ) : null}
      </button>
      {open && hasBody ? (
        <div className="space-y-2 px-3 pb-3 text-[14px] leading-relaxed text-text-primary">
          {move.cue ? <p>{move.cue}</p> : null}
          {move.description ? <p className="text-text-secondary">{move.description}</p> : null}
          {move.why ? (
            <p className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-[13px]">
              <span className="mr-1 text-[10px] font-black uppercase tracking-widest text-accent-ink">
                Why
              </span>
              {move.why}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
