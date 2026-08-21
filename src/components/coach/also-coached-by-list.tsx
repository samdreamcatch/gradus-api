import { ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OtherCoachDTO } from "@/lib/coach-athlete-detail.functions";

function coachMeta(coach: OtherCoachDTO): string {
  const bits: string[] = [];
  if (coach.activeCount > 0) {
    bits.push(`${coach.activeCount} active plan${coach.activeCount === 1 ? "" : "s"}`);
  }
  if (coach.benchedCount > 0) {
    bits.push(`${coach.benchedCount} benched`);
  }
  return bits.join(" · ");
}

export function AlsoCoachedByList({
  coaches,
  onOpenCoach,
  locked = false,
  unlockedCoachIds,
}: {
  coaches: OtherCoachDTO[];
  onOpenCoach: (coachId: string) => void;
  locked?: boolean;
  /** Coaches unlocked for this athlete alone (Team plan coach visibility). */
  unlockedCoachIds?: string[];
}) {
  const unlocked = new Set(unlockedCoachIds ?? []);
  if (coaches.length === 0) return null;
  return (
    <section>
      <h3 className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
        Also coached by
      </h3>
      <ul className="mt-2 space-y-2">
        {coaches.map((c) => {
          const hasPlans = c.plans.length > 0;
          const isLocked = locked && !unlocked.has(c.coachId);
          const interactive = hasPlans && !isLocked;
          const inner = (
            <>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "truncate font-display text-[15px] font-black",
                    interactive ? "text-text-primary" : "text-text-secondary",
                  )}
                >
                  Coach {c.firstName}{" "}
                  <span className={interactive ? "pen-highlight" : undefined}>{c.lastName}</span>
                </div>
                {c.sports.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.sports.map((s) => (
                      <span
                        key={s.key}
                        className="rounded-pill border border-divider bg-elevated px-2 py-0.5 text-[10px] font-medium text-text-secondary"
                      >
                        {s.label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {hasPlans && !isLocked ? (
                  <p className="mt-1 font-hand text-[15px] text-text-secondary">{coachMeta(c)}</p>
                ) : !hasPlans ? (
                  <p className="mt-1 font-hand text-[15px] text-text-tertiary">
                    No shared plans yet
                  </p>
                ) : null}
                {hasPlans && isLocked ? (
                  <div className="mt-2">
                    <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                      CLUB ONLY FEATURE
                    </span>
                  </div>
                ) : null}
              </div>
              {hasPlans ? (
                isLocked ? (
                  <Lock className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                )
              ) : null}
            </>
          );
          return (
            <li key={c.coachId}>
              {interactive ? (
                <button
                  type="button"
                  onClick={() => onOpenCoach(c.coachId)}
                  className="press flex w-full items-center gap-3 rounded-2xl border border-divider bg-card p-3 pl-4 text-left shadow-card"
                >
                  {inner}
                </button>
              ) : (
                <div className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-divider bg-card/40 p-3 pl-4 text-left">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
