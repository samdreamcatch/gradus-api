import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RosterAthlete } from "@/lib/coach-roster.functions";
import type { AthletePracticeSummary } from "@/lib/coach-schedule.functions";
import { PreLessonBriefing } from "./pre-lesson-briefing";
import { LessonSlotSheet, type LessonSlotSheetMode } from "./lesson-slot-sheet";


const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"]; // Mon..Sun
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfWeekMonday(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = out.getDay(); // 0=Sun..6=Sat
  const diff = (dow + 6) % 7; // Mon=0
  out.setDate(out.getDate() - diff);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(minute: number): string {
  const h24 = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h24 >= 12 ? "p" : "a";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function formatRange(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${MONTH_SHORT[start.getMonth()]} ${start.getDate()}–${end.getDate()}`
    : `${MONTH_SHORT[start.getMonth()]} ${start.getDate()} – ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}`;
}

interface DaySession {
  slotId: string;
  athleteId: string;
  name: string;
  dayOfWeek: number; // db format: Sun=0..Sat=6
  startMinute: number;
  endMinute: number;
  overrideStatus: "canceled" | "rescheduled" | null;
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}


export type WeekScheduleHandle = {
  openCreateLesson: () => void;
};

export const WeekScheduleView = forwardRef<
  WeekScheduleHandle,
  {
    athletes: RosterAthlete[];
    summariesByAthlete?: Map<string, AthletePracticeSummary>;
    onSelectAthlete?: (athleteId: string) => void;
    hideInlineCreateButton?: boolean;
  }
>(function WeekScheduleView(
  { athletes, summariesByAthlete, onSelectAthlete, hideInlineCreateButton },
  ref,
) {
  const today = useMemo(() => new Date(), []);
  const currentWeekStart = useMemo(() => startOfWeekMonday(today), [today]);
  const [weekStart, setWeekStart] = useState<Date>(currentWeekStart);
  // 0 = Mon ... 6 = Sun
  const todayIndex = useMemo(
    () => Math.floor((today.getTime() - currentWeekStart.getTime()) / (1000 * 60 * 60 * 24)),
    [today, currentWeekStart],
  );
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(
    todayIndex >= 0 && todayIndex < 7 ? todayIndex : 0,
  );
  const [sheetMode, setSheetMode] = useState<LessonSlotSheetMode | null>(null);
  const sheetOpen = sheetMode != null;

  useImperativeHandle(
    ref,
    () => ({
      openCreateLesson: () =>
        setSheetMode({
          kind: "create",
          defaultDayOfWeek: (weekStart.getDay() + selectedDayIndex) % 7,
        }),
    }),
    [weekStart, selectedDayIndex],
  );


  const weekEnd = addDays(weekStart, 6);
  const isCurrentWeek = sameDay(weekStart, currentWeekStart);

  const sessionsByDay = useMemo(() => {
    const map = new Map<number, DaySession[]>();
    for (let i = 0; i < 7; i++) map.set(i, []);
    for (const a of athletes) {
      const name = `${a.firstName} ${a.lastName}`.trim();
      for (const s of a.slots) {
        const dowIndex = (s.dayOfWeek + 6) % 7; // Mon=0..Sun=6
        const date = addDays(weekStart, dowIndex);
        const iso = toIsoDate(date);
        const override = s.overrides.find((o) => o.date === iso);
        if (override?.status === "canceled") continue;
        const startMinute =
          override?.status === "rescheduled" && override.startMinute != null
            ? override.startMinute
            : s.startMinute;
        const endMinute =
          override?.status === "rescheduled" && override.endMinute != null
            ? override.endMinute
            : s.endMinute;
        map.get(dowIndex)!.push({
          slotId: s.id,
          athleteId: a.athleteId,
          name,
          dayOfWeek: s.dayOfWeek,
          startMinute,
          endMinute,
          overrideStatus: override?.status ?? null,
        });
      }
    }
    for (const arr of map.values()) arr.sort((a, b) => a.startMinute - b.startMinute);
    return map;
  }, [athletes, weekStart]);


  const selectedDate = addDays(weekStart, selectedDayIndex);
  const selectedSessions = sessionsByDay.get(selectedDayIndex) ?? [];
  const isSelectedToday = sameDay(selectedDate, today);

  // Find the next upcoming lesson today within ~2 hours
  const upNext = useMemo(() => {
    if (!isSelectedToday) return null;
    const nowMin = today.getHours() * 60 + today.getMinutes();
    const WINDOW = 120; // minutes
    const candidate = selectedSessions
      .filter((s) => s.endMinute > nowMin && s.startMinute - nowMin <= WINDOW)
      .sort((a, b) => a.startMinute - b.startMinute)[0];
    if (!candidate) return null;
    const yyyy = selectedDate.getFullYear();
    const mm = String(selectedDate.getMonth() + 1).padStart(2, "0");
    const dd = String(selectedDate.getDate()).padStart(2, "0");
    return { session: candidate, lessonDate: `${yyyy}-${mm}-${dd}` };
  }, [isSelectedToday, selectedSessions, today, selectedDate]);

  return (
    <div className="mt-5">
      {/* Week nav + weekday strip */}
      <div className="rounded-2xl border border-divider bg-card p-2 shadow-card">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label="Previous week"
            className="press flex h-9 w-9 items-center justify-center rounded-full text-text-secondary"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex flex-col items-center">
            <span className="font-display text-sm font-black text-text-primary">
              {formatRange(weekStart, weekEnd)}
            </span>
            {!isCurrentWeek ? (
              <button
                type="button"
                onClick={() => setWeekStart(currentWeekStart)}
                className="press-soft mt-0.5 text-[10px] font-bold uppercase tracking-widest text-accent-ink underline"
              >
                Jump to this week
              </button>
            ) : (
              <span className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
                This week
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label="Next week"
            className="press flex h-9 w-9 items-center justify-center rounded-full text-text-secondary"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-2 grid grid-cols-7 gap-1">
          {WEEKDAY_LETTERS.map((letter, i) => {
            const date = addDays(weekStart, i);
            const count = sessionsByDay.get(i)?.length ?? 0;
            const isSelected = selectedDayIndex === i;
            const isDayToday = sameDay(date, today);
            const isEmpty = count === 0;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedDayIndex(i)}
                aria-label={`${DAY_LONG[date.getDay()]} ${date.getDate()}, ${count} session${count === 1 ? "" : "s"}`}
                className={cn(
                  "press-soft flex flex-col items-center gap-0.5 rounded-xl px-1 py-2",
                  isSelected
                    ? "bg-accent text-accent-foreground shadow-sm"
                    : "text-text-secondary",
                  !isSelected && isDayToday && "ring-1 ring-accent",
                  !isSelected && isEmpty && "opacity-50",
                )}
              >
                <span
                  className={cn(
                    "text-[10px] font-bold uppercase tracking-widest",
                    isSelected ? "text-accent-foreground/80" : "text-text-tertiary",
                  )}
                >
                  {letter}
                </span>
                <span className="font-display text-base font-black tabular-nums leading-none">
                  {date.getDate()}
                </span>
                <span
                  className={cn(
                    "mt-0.5 h-1 w-1 rounded-full",
                    count === 0
                      ? "bg-transparent"
                      : isSelected
                        ? "bg-accent-foreground"
                        : "bg-accent",
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      {upNext ? (
        <PreLessonBriefing
          athleteId={upNext.session.athleteId}
          athleteName={upNext.session.name}
          lessonDate={upNext.lessonDate}
          startMinute={upNext.session.startMinute}
        />
      ) : null}

      {athletes.length > 0 && !hideInlineCreateButton ? (
        <button
          type="button"
          onClick={() =>
            setSheetMode({
              kind: "create",
              defaultDayOfWeek: selectedDate.getDay(),
            })
          }
          className="press mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-divider bg-card px-4 py-3 text-sm font-bold uppercase tracking-widest text-text-secondary shadow-card"
        >
          <Plus className="h-4 w-4" />
          Create new lesson
        </button>
      ) : null}

      {/* Selected day */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-divider bg-card shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-divider px-4 py-4">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="font-display text-xl font-black text-text-primary">
              {DAY_LONG[selectedDate.getDay()]}
            </span>
            <span className="text-xs text-text-tertiary tabular-nums">
              {MONTH_SHORT[selectedDate.getMonth()]} {selectedDate.getDate()}
            </span>
            {isSelectedToday ? (
              <span className="rounded-pill bg-accent px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-accent-foreground">
                Today
              </span>
            ) : null}
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
            {selectedSessions.length === 0
              ? "Rest"
              : `${selectedSessions.length} LESSON${selectedSessions.length === 1 ? "" : "S"}`}
          </span>
        </div>


        {selectedSessions.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text-tertiary">
            Rest day — no lessons scheduled
          </div>
        ) : (
          <div className="relative px-4 py-5">
            <div
              aria-hidden
              className="pointer-events-none absolute left-[2.25rem] top-4 bottom-4 w-px bg-divider"
            />
            <ul className="relative space-y-4">
              {selectedSessions.map((s, i) => (
                <li key={`${s.slotId}-${i}`}>
                  <LessonRow
                    session={s}
                    summary={summariesByAthlete?.get(s.athleteId)}
                    onSelect={onSelectAthlete}
                    onEditRecurring={() =>
                      setSheetMode({
                        kind: "edit",
                        slotId: s.slotId,
                        athleteId: s.athleteId,
                        dayOfWeek: s.dayOfWeek,
                        startMinute: s.startMinute,
                        endMinute: s.endMinute,
                      })
                    }
                    onEditOccurrence={() =>
                      setSheetMode({
                        kind: "occurrence",
                        slotId: s.slotId,
                        athleteId: s.athleteId,
                        date: toIsoDate(selectedDate),
                        dayOfWeek: s.dayOfWeek,
                        startMinute: s.startMinute,
                        endMinute: s.endMinute,
                        hasOverride: s.overrideStatus != null,
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        )}



      </div>

      <p className="mt-3 flex items-center gap-2 px-1 text-[10px] uppercase tracking-widest text-text-tertiary">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        Showing recurring weekly lessons
      </p>

      <LessonSlotSheet
        open={sheetOpen}
        onOpenChange={(o) => {
          if (!o) setSheetMode(null);
        }}
        mode={sheetMode}
        athletes={athletes}
      />
    </div>
  );
});


const STATE_COLORS = [
  "var(--pen-pink, var(--text-tertiary))", // 0 frustrated
  "color-mix(in oklab, var(--pen-tennis) 25%, var(--divider))", // 1 pushing
  "color-mix(in oklab, var(--pen-tennis) 50%, var(--divider))", // 2 steady
  "color-mix(in oklab, var(--pen-tennis) 75%, var(--divider))", // 3 locked in
  "var(--pen-tennis)", // 4 flowing
];

function getStatus(hoursLogged: number, expectedHoursPerWeek?: number | null) {
  if (!expectedHoursPerWeek || expectedHoursPerWeek <= 0) return null;
  const ratio = hoursLogged / expectedHoursPerWeek;
  if (ratio > 1.5) return { label: "Over target", tone: "pink" as const };
  if (ratio >= 0.9) return { label: "On track", tone: "tennis" as const };
  if (ratio >= 0.5) return { label: "Light", tone: "orange" as const };
  return { label: "Behind", tone: "pink" as const };
}

function LessonRow({
  session,
  summary,
  onSelect,
  onEditRecurring,
  onEditOccurrence,
}: {
  session: DaySession;
  summary?: AthletePracticeSummary;
  onSelect?: (athleteId: string) => void;
  onEditRecurring?: () => void;
  onEditOccurrence?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex gap-4">
      <div className="w-10 shrink-0 pt-3 text-right">
        <div className="text-[10px] font-bold uppercase tracking-widest tabular-nums text-text-primary leading-none">
          {formatTime(session.startMinute)}
        </div>
        <div className="mt-1 text-[10px] font-bold uppercase tracking-widest tabular-nums text-text-tertiary leading-none">
          {formatTime(session.endMinute)}
        </div>
      </div>
      <div
        className={cn(
          "flex-1 rounded-xl bg-card",
          expanded
            ? "border-2 border-text-primary/80 shadow-card"
            : "border border-divider",
        )}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="press-soft flex w-full items-center justify-between gap-3 p-4 text-left focus-visible:outline-none"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <h3
              className={cn(
                "min-w-0 truncate font-display text-xl font-black leading-tight",
                expanded ? "text-text-primary" : "text-text-primary/85",
              )}
            >
              {session.name}
            </h3>
            {session.overrideStatus === "rescheduled" ? (
              <span className="w-fit rounded-pill border border-[color:var(--pen-orange)]/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-[color:var(--pen-orange-ink)]">
                Rescheduled
              </span>
            ) : null}
          </div>
          <StatusChip summary={summary} />
        </button>

        {expanded ? (
          <div className="px-4 pb-4">
            <PracticeMetric summary={summary} />
            
            <div className="mt-3 flex flex-col gap-2">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(session.athleteId)}
                  className="press w-full rounded-pill border border-text-primary px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-text-primary"
                >
                  View athlete
                </button>
              ) : null}
              {(onEditRecurring || onEditOccurrence) ? (
                <div className="grid grid-cols-2 gap-2">
                  {onEditRecurring ? (
                    <button
                      type="button"
                      onClick={onEditRecurring}
                      className="press inline-flex items-center justify-center gap-1.5 rounded-pill border border-divider/70 px-3 py-2.5 text-[9px] font-black uppercase tracking-[0.15em] text-text-secondary"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                      Edit recurring
                    </button>
                  ) : null}
                  {onEditOccurrence ? (
                    <button
                      type="button"
                      onClick={onEditOccurrence}
                      className="press inline-flex items-center justify-center rounded-pill border border-divider/70 px-3 py-2.5 text-center text-[9px] font-black uppercase tracking-[0.15em] text-text-secondary"
                    >
                      Just this date
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

          </div>
        ) : null}
      </div>
    </div>
  );
}




function StatusChip({ summary }: { summary?: AthletePracticeSummary }) {
  if (!summary) return null;
  const status = getStatus(summary.hoursLogged, summary.expectedHoursPerWeek);
  if (!status) return null;
  const toneClass =
    status.tone === "tennis"
      ? "border-accent/40 text-accent-ink"
      : status.tone === "orange"
        ? "border-[color:var(--pen-orange)]/40 text-[color:var(--pen-orange-ink)]"
        : "border-[color:var(--pen-pink)]/40 text-[color:var(--pen-pink-ink)]";
  return (
    <span
      className={cn(
        "shrink-0 rounded-pill border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest",
        toneClass,
      )}
    >
      {status.label}
    </span>
  );
}

function PracticeMetric({ summary }: { summary?: AthletePracticeSummary }) {
  if (!summary) {
    return (
      <div className="mb-4 h-[68px] animate-pulse rounded-xl bg-divider/40" aria-hidden />
    );
  }
  const { hoursLogged, expectedHoursPerWeek } = summary;
  const hoursStr = hoursLogged > 0 ? hoursLogged.toFixed(1) : "0";
  const hasGoal = !!(expectedHoursPerWeek && expectedHoursPerWeek > 0);
  const ratio = hasGoal ? Math.min(1, hoursLogged / (expectedHoursPerWeek as number)) : 0;
  const pct = Math.round(ratio * 100);
  const dash = Math.max(0, Math.min(100, ratio * 100));

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-divider/60 bg-card/60 p-3">
      <div className="min-w-0">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
          PRACTICE SINCE LAST LESSON
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-3xl font-black leading-none text-text-primary tabular-nums">
            {hoursStr}h
          </span>
          {hasGoal ? (
            <span className="font-display text-base text-text-tertiary tabular-nums">
              / {expectedHoursPerWeek}h goal
            </span>
          ) : (
            <span className="text-xs text-text-tertiary">no weekly goal set</span>
          )}
        </div>
      </div>

      {hasGoal ? (
        <div
          className="relative h-12 w-12 shrink-0"
          aria-label={`${pct}% of weekly goal`}
        >
          <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="var(--divider)"
              strokeWidth="3"
            />
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${dash}, 100`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-black tabular-nums text-text-primary">
            {pct}%
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PracticeFooter({ summary }: { summary?: AthletePracticeSummary }) {
  if (!summary) return null;
  const { sessionStates, sessionCount } = summary;

  if (sessionCount === 0) {
    return (
      <div className="flex items-center justify-between border-t border-divider/60 pt-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
          PRACTICE QUALITY
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
          NO PRACTICE LOGGED
        </span>
      </div>
    );
  }

  const MAX_DOTS = 7;
  const ordered = sessionStates.slice().reverse(); // newest → oldest
  const shown = ordered.slice(0, MAX_DOTS);

  return (
    <div className="flex items-end justify-between border-t border-divider/60 pt-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
          PRACTICE QUALITY
        </span>
        <div className="flex items-center gap-1.5" aria-label={`${sessionCount} sessions logged`}>
          {shown.map((st, idx) => (
            <span
              key={idx}
              className="h-2.5 w-2.5 rounded-full"
              style={{
                background: STATE_COLORS[Math.max(0, Math.min(4, st))],
                boxShadow:
                  st === 4
                    ? "0 0 6px color-mix(in oklab, var(--pen-tennis) 50%, transparent)"
                    : undefined,
              }}
            />
          ))}
        </div>
      </div>
      <div className="text-right leading-tight">
        <div className="font-display text-lg font-black tabular-nums text-text-primary">
          {sessionCount}
        </div>
        <div className="text-[9px] font-bold uppercase tracking-widest text-text-tertiary">
          {sessionCount === 1 ? "Session" : "Sessions"}
        </div>
      </div>
    </div>
  );
}

