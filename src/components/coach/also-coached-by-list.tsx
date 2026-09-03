import { ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { SectionHeader } from "@/components/coach/athlete-section";
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
  visibility,
  askName,
}: {
  coaches: OtherCoachDTO[];
  onOpenCoach: (coachId: string) => void;
  locked?: boolean;
  /** Coaches unlocked for this athlete alone (Team plan coach visibility). */
  unlockedCoachIds?: string[];
  /** Where each other coach's visibility link stands (absent = not requested). */
  visibility?: Record<string, "pending" | "declined" | "accepted">;
  /** Who the coach should ask — the athlete's parent, or the athlete themself. */
  askName?: string | null;
}) {
  const unlocked = new Set(unlockedCoachIds ?? []);

  const lockedLabel = (coachId: string): string => {
    const state = visibility?.[coachId];
    if (state === "pending") return "Pending connection";
    if (state === "declined") return "Connection declined";
    return askName ? `Ask ${askName} to connect you` : "Ask their parent to connect you";
  };
  if (coaches.length === 0) return null;
  return (
    <section>
      <SectionHeader title="Also coached by" />
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
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {c.sports.map((s) => (
                    <Tag key={s.key} size="micro" mono={false}>
                      {s.label}
                    </Tag>
                  ))}
                  {hasPlans && !isLocked ? (
                    <span className="text-sm text-text-secondary">{coachMeta(c)}</span>
                  ) : !hasPlans ? (
                    <span className="text-sm text-text-tertiary">No shared plans yet</span>
                  ) : null}
                  {hasPlans && isLocked ? (
                    <Tag size="micro" tone="muted" mono={false}>
                      {lockedLabel(c.coachId)}
                    </Tag>
                  ) : null}
                </div>
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
                <Card
                  variant="row"
                  asChild={undefined}
                  className="press flex w-full cursor-pointer items-center gap-3 text-left"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenCoach(c.coachId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenCoach(c.coachId);
                    }
                  }}
                >
                  {inner}
                </Card>
              ) : (
                <Card
                  variant="row"
                  className="flex w-full items-center gap-3 border-dashed bg-card/40 text-left shadow-none"
                >
                  {inner}
                </Card>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
