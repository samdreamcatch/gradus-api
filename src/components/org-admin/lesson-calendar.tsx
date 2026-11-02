import type React from "react";
import { ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { addDays, lessonsOn, monthGrid, toIso, weekDays, type ClubLesson } from "@/lib/club-lesson-calendar";
import { formatTimeLabel } from "@/lib/schedule-import";
import { cn } from "@/lib/utils";

// Literal classes so Tailwind can see them; washes keep the page calm while telling coaches apart.
const COACH_PENS = ["pool", "tennis", "iris", "orange", "pink"];
export function coachTone(coachId: string, coachIds: string[]): React.CSSProperties {
  const pen = COACH_PENS[Math.max(0, coachIds.indexOf(coachId)) % COACH_PENS.length];
  return { background: `var(--pen-${pen}-wash)`, color: `var(--pen-${pen}-ink)`, borderLeftColor: `var(--pen-${pen})` };
}

const HOUR_PX = 56;
const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...opts });
const needsAttention = (l: ClubLesson) => l.invitationStatus === "Contact missing" || l.invitationStatus === "Not invited";

export function LessonCalendar({ lessons, coachIds, mode, date, onModeChange, onDateChange, onOpen }: {
  lessons: ClubLesson[]; coachIds: string[]; mode: "week" | "month"; date: string;
  onModeChange: (m: "week" | "month") => void; onDateChange: (iso: string) => void; onOpen: (l: ClubLesson) => void;
}) {
  const today = toIso(new Date());
  const days = mode === "week" ? weekDays(date) : monthGrid(date);
  const title = mode === "week"
    ? `${fmtDay(days[0]!, { month: "short", day: "numeric" })} – ${fmtDay(days[6]!, { month: "short", day: "numeric", year: "numeric" })}`
    : fmtDay(date, { month: "long", year: "numeric" });
  const step = (dir: number) => {
    if (mode === "week") return onDateChange(addDays(date, dir * 7));
    const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + dir); onDateChange(toIso(d));
  };

  return <div className="min-w-0 overflow-hidden rounded-md border border-divider bg-card">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider bg-elevated px-3 py-2">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label={mode === "week" ? "Previous week" : "Previous month"} onClick={() => step(-1)}><ChevronLeft className="size-4" /></Button>
        <Button variant="ghost" size="icon" aria-label={mode === "week" ? "Next week" : "Next month"} onClick={() => step(1)}><ChevronRight className="size-4" /></Button>
        <Button variant="outline" size="sm" onClick={() => onDateChange(today)}>Today</Button>
        <h3 className="ml-2 font-display text-lg">{title}</h3>
      </div>
      <ToggleGroup type="single" value={mode} onValueChange={(v) => v && onModeChange(v as "week" | "month")} aria-label="Calendar range">
        <ToggleGroupItem value="week" className="press-soft px-3">Week</ToggleGroupItem>
        <ToggleGroupItem value="month" className="press-soft px-3">Month</ToggleGroupItem>
      </ToggleGroup>
    </div>
    {mode === "week" ? <WeekGrid days={days} today={today} lessons={lessons} coachIds={coachIds} onOpen={onOpen} />
      : <MonthGrid days={days} month={date.slice(0, 7)} today={today} lessons={lessons} coachIds={coachIds} onOpen={onOpen} onPickDay={(iso) => { onDateChange(iso); onModeChange("week"); }} />}
  </div>;
}

function WeekGrid({ days, today, lessons, coachIds, onOpen }: { days: string[]; today: string; lessons: ClubLesson[]; coachIds: string[]; onOpen: (l: ClubLesson) => void }) {
  const firstHour = lessons.length ? Math.max(0, Math.floor(Math.min(...lessons.map((l) => l.start)) / 60) - 1) : 8;
  const lastHour = lessons.length ? Math.min(24, Math.ceil(Math.max(...lessons.map((l) => l.end)) / 60) + 1) : 18;
  const hours = Array.from({ length: Math.max(1, lastHour - firstHour) }, (_, i) => firstHour + i);
  return <div className="overflow-x-auto"><div className="grid min-w-[760px] grid-cols-[56px_repeat(7,minmax(0,1fr))]">
    <div className="sticky top-0 border-b border-divider bg-elevated" />
    {days.map((iso) => <div key={iso} className={cn("border-b border-l border-divider bg-elevated px-2 py-1.5 text-center", iso === today && "text-accent-ink")}>
      <div className="text-caption uppercase text-text-secondary">{fmtDay(iso, { weekday: "short" })}</div>
      <div className={cn("font-mono text-sm tabular-nums", iso === today && "font-semibold")}>{fmtDay(iso, { day: "numeric" })}</div>
    </div>)}
    <div className="relative" style={{ height: hours.length * HOUR_PX }}>
      {hours.map((h, i) => <div key={h} className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-text-tertiary" style={{ top: i * HOUR_PX }}>{i === 0 ? "" : formatTimeLabel(h * 60)}</div>)}
    </div>
    {days.map((iso) => {
      const dayLessons = lessonsOn(lessons, iso);
      return <div key={iso} className={cn("relative border-l border-divider", iso === today && "bg-accent/5")} style={{ height: hours.length * HOUR_PX }}>
        {hours.map((h, i) => <div key={h} className="absolute inset-x-0 border-t border-divider/60" style={{ top: i * HOUR_PX }} />)}
        {layoutOverlaps(dayLessons).map(({ lesson: l, col, cols }) => <button key={l.id} type="button" onClick={() => onOpen(l)}
          aria-label={`${l.studentName} with ${l.coachName}, ${formatTimeLabel(l.start)} to ${formatTimeLabel(l.end)}`}
          className={cn("press absolute min-h-0! overflow-hidden rounded-sm border-l-4 px-1.5 py-1 text-left text-xs leading-tight shadow-sm")}
          style={{ ...coachTone(l.coachId, coachIds), top: ((l.start - firstHour * 60) / 60) * HOUR_PX + 1, height: Math.max(22, (l.minutes / 60) * HOUR_PX - 2), left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}>
          <div className="flex items-center gap-1 font-semibold">{needsAttention(l) && <AlertCircle className="size-3 shrink-0 text-destructive" aria-label={l.invitationStatus} />}<span className="truncate">{l.studentName}</span></div>
          <div className="truncate font-mono text-[10px] opacity-80">{formatTimeLabel(l.start)} · {l.coachName}</div>
        </button>)}
      </div>;
    })}
  </div></div>;
}

function MonthGrid({ days, month, today, lessons, coachIds, onOpen, onPickDay }: { days: string[]; month: string; today: string; lessons: ClubLesson[]; coachIds: string[]; onOpen: (l: ClubLesson) => void; onPickDay: (iso: string) => void }) {
  const MAX = 3;
  return <div className="overflow-x-auto"><div className="grid min-w-[760px] grid-cols-7">
    {days.slice(0, 7).map((iso) => <div key={iso} className="border-b border-l border-divider bg-elevated px-2 py-1.5 text-caption uppercase text-text-secondary first:border-l-0">{fmtDay(iso, { weekday: "short" })}</div>)}
    {days.map((iso, i) => {
      const dayLessons = lessonsOn(lessons, iso);
      const inMonth = iso.startsWith(month);
      return <div key={iso} className={cn("min-h-28 border-b border-l border-divider p-1.5", i % 7 === 0 && "border-l-0", !inMonth && "bg-elevated/60 text-text-tertiary")}>
        <button type="button" onClick={() => onPickDay(iso)} aria-label={`Open week of ${fmtDay(iso, { month: "long", day: "numeric" })}`}
          className={cn("press-soft mb-1 inline-flex size-6 min-h-0! items-center justify-center rounded-pill font-mono text-xs tabular-nums", iso === today && "bg-accent text-accent-foreground")}>{fmtDay(iso, { day: "numeric" })}</button>
        <div className="space-y-0.5">
          {dayLessons.slice(0, MAX).map((l) => <button key={l.id} type="button" onClick={() => onOpen(l)}
            className={cn("press flex min-h-0! w-full items-center gap-1 truncate rounded-sm border-l-[3px] px-1 py-0.5 text-left text-[11px]")} style={coachTone(l.coachId, coachIds)}>
            {needsAttention(l) && <AlertCircle className="size-3 shrink-0 text-destructive" aria-label={l.invitationStatus} />}
            <span className="font-mono opacity-80">{formatTimeLabel(l.start)}</span><span className="truncate font-semibold">{l.studentName}</span>
          </button>)}
          {dayLessons.length > MAX && <button type="button" onClick={() => onPickDay(iso)} className="press-soft min-h-0! px-1 text-[11px] text-text-secondary">+{dayLessons.length - MAX} more</button>}
        </div>
      </div>;
    })}
  </div></div>;
}

/** Side-by-side columns for overlapping lessons within a day. */
function layoutOverlaps(day: ClubLesson[]) {
  const out: { lesson: ClubLesson; col: number; cols: number }[] = [];
  let cluster: { lesson: ClubLesson; col: number }[] = []; let clusterEnd = -1; const colEnds: number[] = [];
  const flush = () => { const cols = Math.max(1, ...cluster.map((c) => c.col + 1)); cluster.forEach((c) => out.push({ ...c, cols })); cluster = []; colEnds.length = 0; };
  for (const l of day) {
    if (l.start >= clusterEnd && cluster.length) flush();
    let col = colEnds.findIndex((end) => end <= l.start); if (col === -1) col = colEnds.length;
    colEnds[col] = l.end; cluster.push({ lesson: l, col }); clusterEnd = Math.max(clusterEnd, l.end);
  }
  if (cluster.length) flush();
  return out;
}
