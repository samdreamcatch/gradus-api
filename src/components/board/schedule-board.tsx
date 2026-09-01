import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
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

function shortDay(key: string, fallback: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return fallback || key;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

/**
 * The competition at a glance, the way a departures board reads it: time,
 * event, sheet, status — one day at a time, past days included. Rows carrying
 * one of the viewer's skaters are marked; tapping a row opens its results.
 */
export function ScheduleBoard({
  schedule,
  myNames,
  onOpenEvent,
}: {
  schedule: BoardEvent[];
  myNames: string[];
  onOpenEvent: (event: BoardEvent) => void;
}) {
  const days = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of schedule) if (!seen.has(e.dayKey)) seen.set(e.dayKey, e.dayLabel);
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
  }, [schedule]);

  // Land on the day that is actually happening: live first, then the next one.
  const defaultDay = useMemo(() => {
    const live = schedule.find((e) => e.status === "live");
    if (live) return live.dayKey;
    const now = Date.now();
    const soon = schedule.find((e) => e.startIso && Date.parse(e.startIso) >= now);
    return soon?.dayKey ?? days[days.length - 1]?.key ?? "";
  }, [schedule, days]);

  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && days.some((d) => d.key === picked) ? picked : defaultDay;

  if (schedule.length === 0) {
    return (
      <Card variant="section">
        <p className="text-sm text-text-secondary">
          The schedule hasn&apos;t been published yet. It fills in as soon as the competition posts
          its running order.
        </p>
      </Card>
    );
  }

  const wanted = new Set(myNames.map(normalizeName));
  const rows = schedule.filter((e) => e.dayKey === day);

  return (
    <div className="space-y-3">
      {days.length > 1 ? (
        <div role="radiogroup" aria-label="Competition day" className="flex flex-wrap gap-2">
          {days.map((d) => (
            <Chip
              key={d.key}
              size="caption"
              role="radio"
              aria-checked={d.key === day}
              selected={d.key === day}
              onClick={() => setPicked(d.key)}
            >
              {shortDay(d.key, d.label)}
            </Chip>
          ))}
        </div>
      ) : null}

      <Card variant="section" className="space-y-2">
        <div
          aria-hidden="true"
          className="flex items-baseline gap-3 font-mono text-nano uppercase tracking-wider text-text-tertiary"
        >
          <span className="w-14">Time</span>
          <span className="min-w-0 flex-1">Event</span>
          <span className="w-16 text-right">Status</span>
        </div>

        <div className="divide-y divide-divider">
          {rows.map((e) => {
            const mine = e.results.some((s) => wanted.has(normalizeName(s.name)));
            const scored = e.results.some((s) => s.segScore || s.total);
            const label = [
              timeOf(e.startIso, e.timeLabel),
              [e.name, e.segment].filter(Boolean).join(" "),
              STATUS_LABEL[e.status].toLowerCase(),
              e.count ? `${e.count} skaters` : "",
              e.rink,
              mine ? "your skater" : "",
              scored ? "see results" : "",
            ]
              .filter(Boolean)
              .join(", ");
            const meta = [e.rink, e.count ? `${e.count} skaters` : "", scored ? "results ›" : ""]
              .filter(Boolean)
              .join(" · ");
            return (
              <button
                key={`${e.file}-${e.startIso}`}
                type="button"
                onClick={() => onOpenEvent(e)}
                aria-label={label}
                className={cn(
                  "press-soft flex min-h-11 w-full items-center gap-3 border-l-2 py-2 pl-2 text-left",
                  mine ? "border-accent bg-accent/10" : "border-transparent",
                )}
              >
                <span className="w-14 shrink-0 font-mono text-sm text-text-primary tabular-nums">
                  {timeOf(e.startIso, e.timeLabel)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text-primary">
                    {[e.name, e.segment].filter(Boolean).join(" · ")}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-nano text-text-tertiary">
                    {meta}
                  </span>
                </span>
                <span className="flex w-16 shrink-0 items-center justify-end gap-1.5">
                  {e.status === "live" ? (
                    <span className="board-live-dot shrink-0" aria-hidden="true" />
                  ) : null}
                  <Tag size="nano" tone={e.status === "live" ? "accent" : "default"}>
                    {STATUS_LABEL[e.status]}
                  </Tag>
                </span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
