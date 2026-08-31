import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { normalizeName, type BoardEvent } from "@/lib/board-types";

function timeOf(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

const STATUS_LABEL: Record<BoardEvent["status"], string> = {
  scheduled: "SCHEDULED",
  live: "LIVE",
  final: "FINAL",
};

/**
 * The whole day at a glance, the way a departures board reads it: time, event,
 * sheet, status. Rows carrying one of the viewer's skaters are marked.
 */
export function ScheduleBoard({
  schedule,
  myNames,
  onSelectRink,
}: {
  schedule: BoardEvent[];
  myNames: string[];
  onSelectRink: (rink: string) => void;
}) {
  if (schedule.length === 0) {
    return (
      <Card variant="section">
        <p className="text-sm text-text-secondary">
          The day&apos;s schedule hasn&apos;t been published yet. It fills in as soon as the
          competition posts its running order.
        </p>
      </Card>
    );
  }

  const wanted = new Set(myNames.map(normalizeName));

  return (
    <Card variant="section" className="space-y-2">
      <div
        aria-hidden="true"
        className="flex items-baseline gap-3 font-mono text-nano uppercase tracking-wider text-text-tertiary"
      >
        <span className="w-14">Time</span>
        <span className="min-w-0 flex-1">Event</span>
        <span className="w-14 text-right">Rink</span>
      </div>

      <div className="divide-y divide-divider">
        {schedule.map((e) => {
          const mine = e.results.some((s) => wanted.has(normalizeName(s.name)));
          const label = [
            timeOf(e.startIso, e.timeLabel),
            [e.name, e.segment].filter(Boolean).join(" "),
            STATUS_LABEL[e.status].toLowerCase(),
            e.count ? `${e.count} skaters` : "",
            e.rink,
            mine ? "your skater" : "",
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <button
              key={`${e.file}-${e.startIso}`}
              type="button"
              onClick={() => onSelectRink(e.rink)}
              aria-label={label}
              className={cn(
                "press-soft flex min-h-11 w-full items-baseline gap-3 py-2 text-left",
                mine && "bg-accent/10",
              )}
            >
              <span className="w-14 shrink-0 font-mono text-sm text-text-primary tabular-nums">
                {timeOf(e.startIso, e.timeLabel)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text-primary">
                  {[e.name, e.segment].filter(Boolean).join(" · ")}
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <Tag size="nano" tone={e.status === "live" ? "accent" : "default"}>
                    {STATUS_LABEL[e.status]}
                  </Tag>
                  {e.count ? (
                    <span className="font-mono text-nano text-text-tertiary">
                      {e.count} skaters
                    </span>
                  ) : null}
                  {mine ? (
                    <Eyebrow size="nano" className="text-accent-ink">
                      YOUR SKATER
                    </Eyebrow>
                  ) : null}
                </span>
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-xs text-text-tertiary">
                {e.rink}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
