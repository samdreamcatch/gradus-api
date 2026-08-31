import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { standingsOf, type BoardEvent, type BoardSkater } from "@/lib/board-types";

const MEDAL = ["GOLD", "SILVER", "BRONZE"];

const ORDINAL = ["first", "second", "third"];

function placeOf(s: BoardSkater): string {
  return (s.finalPlace || s.place || "").trim();
}

/**
 * How an event finished: final standings in placement order, medals marked,
 * every posted score in view. Same published data the live lanes read — no
 * extra request, just sorted by result instead of start order.
 */
export function EventResults({
  event,
  onOpenChange,
  onOpenScore,
}: {
  event: BoardEvent | null;
  onOpenChange: (open: boolean) => void;
  onOpenScore: (skater: BoardSkater) => void;
}) {
  const rows = event ? standingsOf(event) : [];
  const combined = rows.some((r) => (r.segScores?.length ?? 0) > 1);

  return (
    <Sheet open={!!event} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="paper-surface max-h-[90dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-h3 text-text-primary">
            {[event?.name, event?.segment].filter(Boolean).join(" · ") || "Results"}
          </SheetTitle>
          <p className="flex items-center gap-2 font-mono text-xs text-text-tertiary">
            <Tag size="nano" tone={event?.status === "live" ? "accent" : "default"}>
              {event?.status === "final"
                ? "FINAL"
                : event?.status === "live"
                  ? "IN PROGRESS"
                  : "SCHEDULED"}
            </Tag>
            <span>
              {[event?.dayLabel, event?.timeLabel, event?.rink].filter(Boolean).join(" · ")}
            </span>
          </p>
        </SheetHeader>

        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-text-secondary">
            No results posted yet. They appear here as soon as the competition publishes them.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-divider">
            {rows.map((s) => {
              const place = placeOf(s);
              const n = Number(place);
              const medal = Number.isFinite(n) && n >= 1 && n <= 3 ? MEDAL[n - 1] : null;
              const score = s.total || s.segScore;
              const label = [
                medal ? `${ORDINAL[n - 1]} place` : place ? `place ${place}` : "unplaced",
                s.name,
                s.club,
                score ? `score ${score}` : "no score yet",
                s.protocol ? "open protocol" : "",
              ]
                .filter(Boolean)
                .join(", ");
              return (
                <button
                  key={`${s.start}-${s.name}`}
                  type="button"
                  disabled={!s.protocol}
                  aria-label={label}
                  onClick={() => s.protocol && onOpenScore(s)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 py-2 text-left",
                    s.protocol ? "press-soft" : "cursor-default",
                  )}
                >
                  <span className="w-6 shrink-0 font-mono text-sm text-text-primary tabular-nums">
                    {place || "–"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm text-text-primary">{s.name}</span>
                      {medal ? (
                        <Tag size="nano" tone="accent">
                          {medal}
                        </Tag>
                      ) : null}
                    </span>
                    <span className="block truncate font-mono text-nano text-text-tertiary">
                      {s.club}
                      {combined && s.segScores?.length
                        ? ` · ${s.segScores
                            .filter((x) => x.score)
                            .map((x) => `${x.segment} ${x.score}`)
                            .join(" · ")}`
                        : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-sm text-text-primary tabular-nums">
                      {score || "—"}
                    </span>
                    {s.protocol ? (
                      <span className="block font-mono text-nano uppercase tracking-wider text-text-tertiary">
                        protocol
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
