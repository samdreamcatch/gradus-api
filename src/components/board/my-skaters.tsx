import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import {
  normalizeName,
  type BoardEvent,
  type BoardPayload,
  type BoardSkater,
} from "@/lib/board-types";

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
export function allEvents(payload: BoardPayload): BoardEvent[] {
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
      dayLabel: "",
      dayKey: c.startIso ? c.startIso.slice(0, 10) : "",
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

/**
 * The right-hand tag: a time, not a jargon state. On the ice now and already
 * scored are the only two cases a clock can't express.
 */
function stateTag(m: SkaterMatch): string {
  if (m.state === "on-ice") return "ON THE ICE";
  if (m.state === "scored") return m.skater.segScore ? `${m.skater.segScore}` : "SCORED";
  return m.event.timeLabel || "TBD";
}

/** Location · event start · skate order. Nothing else. */
function metaParts(m: SkaterMatch): string[] {
  const of = m.skater.of || m.event.count || 0;
  return [
    m.event.rink,
    m.event.timeLabel ? `starts ${m.event.timeLabel}` : "",
    of ? `skates ${ordinal(m.skater.start)} of ${of}` : `skates ${ordinal(m.skater.start)}`,
  ].filter(Boolean);
}


function ordinal(n: number | string): string {
  const v = typeof n === "number" ? n : parseInt(String(n), 10);
  if (!Number.isFinite(v)) return String(n);
  const rem100 = v % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${v}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[v % 10] ?? "th";
  return `${v}${suffix}`;
}


/**
 * The viewer's own athletes, first thing on the board — a coach sees the whole
 * roster, a parent sees their children. One compact block per skater, with a
 * row per event they're entered in that day.
 */
export function MySkaters({
  matches,
  followed,
  changed,
  onToggleFollow,
  onOpenScore,
}: {
  matches: SkaterMatch[];
  followed: (m: SkaterMatch) => boolean;
  changed: Set<string>;
  onToggleFollow: (m: SkaterMatch) => void;
  onOpenScore: (m: SkaterMatch) => void;
}) {
  if (matches.length === 0) return null;

  const groups: { name: string; rows: SkaterMatch[] }[] = [];
  for (const m of matches) {
    const key = normalizeName(m.skater.name);
    const found = groups.find((g) => normalizeName(g.name) === key);
    if (found) found.rows.push(m);
    else groups.push({ name: m.skater.name, rows: [m] });
  }

  return (
    <Card variant="section" className="space-y-3">
      <Eyebrow as="h2" size="micro" tone="tertiary">
        {groups.length > 1 ? "YOUR SKATERS" : "YOUR SKATER"}
      </Eyebrow>

      <div className="divide-y divide-divider">
        {groups.map((g) => {
          const head = g.rows[0];
          const isFollowed = followed(head);
          return (
            <div key={normalizeName(g.name)} className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className="min-w-0 truncate text-sm font-bold text-text-primary">{g.name}</h3>
                <Chip
                  size="nano"
                  selected={isFollowed}
                  aria-pressed={isFollowed}
                  aria-label={isFollowed ? `Stop following ${g.name}` : `Follow ${g.name}`}
                  onClick={() => onToggleFollow(head)}
                >
                  {isFollowed ? "Following" : "Follow"}
                </Chip>
              </div>

              <div className="mt-1 space-y-1">
                {g.rows.map((m) => {
                  const tappable = !!m.skater.protocol;
                  const Wrapper = tappable ? "button" : "div";
                  return (
                    <Wrapper
                      key={m.key}
                      {...(tappable
                        ? {
                            type: "button" as const,
                            onClick: () => onOpenScore(m),
                            "aria-label": `Score detail for ${m.skater.name}`,
                          }
                        : {})}
                      className={cn(
                        "block w-full rounded-lg px-2 py-1 text-left transition-colors duration-700",
                        tappable && "press-soft",
                        changed.has(m.key) ? "bg-accent/10" : "bg-elevated",
                      )}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                          {[m.event.name, m.event.segment].filter(Boolean).join(" · ")}
                        </span>
                        <Tag size="nano" tone={m.state === "on-ice" ? "accent" : "default"}>
                          {STATE_LABEL[m.state]}
                        </Tag>
                      </div>
                      <p className="font-mono text-nano text-text-tertiary tabular-nums">
                        {metaParts(m).join(" · ")}
                        {tappable ? " ›" : ""}
                      </p>

                    </Wrapper>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
