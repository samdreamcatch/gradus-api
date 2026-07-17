import { ChevronRight } from "lucide-react";
import type { OtherCoachDTO } from "@/lib/coach-athlete-detail.functions";

function coachMeta(coach: OtherCoachDTO): string {
  const bits: string[] = [];
  if (coach.activeCount > 0) {
    bits.push(`${coach.activeCount} active plan${coach.activeCount === 1 ? "" : "s"}`);
  }
  if (coach.benchedCount > 0) {
    bits.push(`${coach.benchedCount} benched`);
  }
  return bits.length > 0 ? bits.join(" · ") : "No active plans";
}

export function AlsoCoachedByList({
  coaches,
  onOpenCoach,
}: {
  coaches: OtherCoachDTO[];
  onOpenCoach: (coachId: string) => void;
}) {
  if (coaches.length === 0) return null;
  return (
    <section>
      <h3 className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
        Also coached by
      </h3>
      <ul className="mt-2 space-y-2">
        {coaches.map((c) => (
          <li key={c.coachId}>
            <button
              type="button"
              onClick={() => onOpenCoach(c.coachId)}
              className="press flex w-full items-center gap-3 rounded-2xl border border-divider bg-card p-3 pl-4 text-left shadow-card"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-[15px] font-black text-text-primary">
                  Coach {c.firstName}{" "}
                  <span className="pen-highlight">{c.lastName}</span>
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
                <p className="mt-1 font-hand text-[15px] text-text-secondary">
                  {coachMeta(c)}
                </p>
              </div>
              <ChevronRight
                className="size-4 shrink-0 text-text-tertiary"
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
