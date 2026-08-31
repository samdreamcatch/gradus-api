import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { normalizeName, type BoardEvent, type BoardPayload, type BoardSkater } from "@/lib/board-types";

/** Rough pace of an IJS event, used only for the "about" estimate. */
const MINUTES_PER_SKATER = 4.5;

export interface SkaterMatch {
  key: string;
  skater: BoardSkater;
  event: BoardEvent;
  /** How many skaters have posted a score in this event. */
  done: number;
  /** Skaters between this one and the ice. Negative once they have skated. */
  ahead: number;
  state: "scored" | "on-ice" | "up-next" | "waiting" | "scheduled";
  sortAt: number;
}

/** Every event on the day, plus the live events held in the rink panels. */
function allEvents(payload: BoardPayload): BoardEvent[] {
  const list = [...(payload.schedule ?? [])];
  for (const rink of payload.rinks) {
    const c = rink.current;
    if (!c) continue;
    const known = list.find((e) => e.name === c.event && e.rink === rink.name);
    if (known) {
      if (known.results.length === 0) known.results = c.startOrder;
      continue;
    }
    list.push({
      file: `${rink.name}:${c.event}`,
      name: c.event,
      segment: c.segment,
      rink: rink.name,
      timeLabel: c.startLabel,
      startIso: c.startIso,
      status: "live",
      count: c.skaters,
      results: c.startOrder,
    });
  }
  return list;
}

/** Find every athlete this viewer follows anywhere in the day's schedule. */
export function findMySkaters(payload: BoardPayload | null, names: string[]): SkaterMatch[] {
  if (!payload || names.length === 0) return [];
  const wanted = new Set(names.map(normalizeName));
  const out: SkaterMatch[] = [];

  for (const event of allEvents(payload)) {
    const done = event.results.filter((s) => s.segScore).length;
    for (const s of event.results) {
      if (!wanted.has(normalizeName(s.name))) continue;
      const ahead = s.start - done - 1;
      const state: SkaterMatch["state"] = s.segScore
        ? "scored"
        : event.status !== "live"
          ? "scheduled"
          : ahead <= 0
            ? "on-ice"
            : ahead === 1
              ? "up-next"
              : "waiting";
      const start = event.startIso ? new Date(event.startIso).getTime() : Number.MAX_SAFE_INTEGER;
      out.push({
        key: `${event.file}:${s.start}:${s.name}`,
        skater: s,
        event,
        done,
        ahead,
        state,
        sortAt: state === "scored" ? start + 1e11 : state === "scheduled" ? start : start - 1e11,
      });
    }
  }

  return out.sort((a, b) => a.sortAt - b.sortAt);
}

const STATE_LABEL: Record<SkaterMatch["state"], string> = {
  scored: "SCORED",
  "on-ice": "ON THE ICE",
  "up-next": "UP NEXT",
  waiting: "WAITING",
  scheduled: "SCHEDULED",
};

function line(m: SkaterMatch): string {
  if (m.state === "scored") {
    return [m.skater.segScore ? `scored ${m.skater.segScore}` : "", m.skater.place ? `currently ${m.skater.place}` : ""]
      .filter(Boolean)
      .join(" · ");
  }
  if (m.state === "on-ice") return "on the ice now — score posts a minute or two late";
  if (m.state === "scheduled") return `${m.event.timeLabel} · ${m.event.count ?? m.skater.of} skaters`;
  const mins = Math.max(1, Math.round(m.ahead * MINUTES_PER_SKATER));
  return `${m.ahead} ${m.ahead === 1 ? "skater" : "skaters"} ahead · about ${mins} min`;
}

/**
 * The viewer's own athletes, first thing on the board — a coach sees the whole
 * roster, a parent sees their children. Ordered by who is closest to the ice.
 */
export function MySkaters({
  matches,
  followed,
  changed,
  onToggleFollow,
  onSelectRink,
  onOpenScore,
}: {
  matches: SkaterMatch[];
  followed: (m: SkaterMatch) => boolean;
  changed: Set<string>;
  onToggleFollow: (m: SkaterMatch) => void;
  onSelectRink: (rink: string) => void;
  onOpenScore: (m: SkaterMatch) => void;
}) {
  if (matches.length === 0) return null;

  return (
    <Card variant="section" className="space-y-3">
      <Eyebrow size="micro" tone="tertiary">
        {matches.length > 1 ? "YOUR SKATERS" : "YOUR SKATER"}
      </Eyebrow>

      <div className="space-y-2">
        {matches.map((m) => (
          <div
            key={m.key}
            className={cn(
              "rounded-xl border border-divider px-3 py-2 transition-colors duration-700",
              changed.has(m.key) ? "border-accent/50 bg-accent/10" : "bg-elevated",
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-base font-bold text-text-primary">
                {m.skater.name}
              </p>
              <Tag size="caption" tone={m.state === "on-ice" ? "accent" : "default"}>
                {STATE_LABEL[m.state]}
              </Tag>
            </div>

            <p className="mt-0.5 truncate text-sm text-text-secondary">
              {[m.event.name, m.event.segment].filter(Boolean).join(" · ")}
            </p>
            <p className="font-mono text-xs text-text-tertiary">
              {m.event.rink} · skates {m.skater.start} of {m.skater.of || m.event.count || "?"}
            </p>
            <p className="mt-1 font-mono text-xs text-text-secondary tabular-nums">{line(m)}</p>

            <div className="mt-2 flex flex-wrap gap-2">
              <Chip size="caption" selected={followed(m)} onClick={() => onToggleFollow(m)}>
                {followed(m) ? "Following" : "Follow"}
              </Chip>
              <Chip size="caption" onClick={() => onSelectRink(m.event.rink)}>
                Go to {m.event.rink}
              </Chip>
              {m.skater.protocol ? (
                <Chip size="caption" onClick={() => onOpenScore(m)}>
                  Score detail
                </Chip>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
