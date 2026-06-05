import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RosterAthlete } from "@/lib/coach-roster.functions";
import type { AthletePracticeSummary } from "@/lib/coach-schedule.functions";

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
  athleteId: string;
  name: string;
  startMinute: number;
  endMinute: number;
}

export function WeekScheduleView({
  athletes,
  summariesByAthlete,
  onSelectAthlete,
}: {
  athletes: RosterAthlete[];
  summariesByAthlete?: Map<string, AthletePracticeSummary>;
  onSelectAthlete?: (athleteId: string) => void;
}) {
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

  const weekEnd = addDays(weekStart, 6);
  const isCurrentWeek = sameDay(weekStart, currentWeekStart);

  const sessionsByDay = useMemo(() => {
    const map = new Map<number, DaySession[]>();
    for (let i = 0; i < 7; i++) map.set(i, []);
    for (const a of athletes) {
      const name = `${a.firstName} ${a.lastName}`.trim();
      for (const s of a.slots) {
        const dowIndex = (s.dayOfWeek + 6) % 7; // Mon=0..Sun=6
        map.get(dowIndex)!.push({
          athleteId: a.athleteId,
          name,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
        });
      }
    }
    for (const arr of map.values()) arr.sort((a, b) => a.startMinute - b.startMinute);
    return map;
  }, [athletes]);

  const selectedDate = addDays(weekStart, selectedDayIndex);
  const selectedSessions = sessionsByDay.get(selectedDayIndex) ?? [];
  const isSelectedToday = sameDay(selectedDate, today);

  return (
    <div className="mt-5">
      {/* Week nav + weekday strip */}
      <div className="rounded-2xl border border-divider bg-card p-2 shadow-card">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label="Previous week"
            className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:bg-elevated hover:text-text-primary"
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
                className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-accent-ink hover:underline"
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
            className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:bg-elevated hover:text-text-primary"
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
                  "flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 transition",
                  isSelected
                    ? "bg-accent text-accent-foreground shadow-sm"
                    : "text-text-secondary hover:bg-elevated hover:text-text-primary",
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

      {/* Selected day */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-divider bg-card shadow-card">
        <div className="flex items-baseline justify-between gap-3 border-b border-divider/60 px-4 py-3">
          <div className="flex items-baseline gap-2">
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
              : `${selectedSessions.length} session${selectedSessions.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {selectedSessions.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text-tertiary">
            Rest day — no lessons scheduled
          </div>
        ) : (
          <ul className="divide-y divide-divider/50">
            {selectedSessions.map((s, i) => {
              const summary = summariesByAthlete?.get(s.athleteId);
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onSelectAthlete?.(s.athleteId)}
                    className="flex w-full items-start gap-4 px-4 py-3 text-left transition hover:bg-elevated focus-visible:outline-none focus-visible:bg-elevated"
                  >
                    <div className="w-16 shrink-0 font-display text-base font-black tabular-nums text-text-primary">
                      {formatTime(s.startMinute)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold text-text-primary">{s.name}</div>
                      <div className="text-xs text-text-secondary tabular-nums">
                        {formatTime(s.startMinute)} – {formatTime(s.endMinute)}
                      </div>
                      <PracticeSinceLast summary={summary} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="mt-3 px-1 text-[10px] uppercase tracking-widest text-text-tertiary">
        Showing recurring weekly lessons
      </p>
    </div>
  );
}

const STATE_COLORS = [
  "var(--pen-pink, var(--text-tertiary))", // 0 frustrated
  "color-mix(in oklab, var(--pen-tennis) 25%, var(--divider))", // 1 pushing
  "color-mix(in oklab, var(--pen-tennis) 50%, var(--divider))", // 2 steady
  "color-mix(in oklab, var(--pen-tennis) 75%, var(--divider))", // 3 locked in
  "var(--pen-tennis)", // 4 flowing
];

function PracticeSinceLast({ summary }: { summary?: AthletePracticeSummary }) {
  if (!summary) {
    return (
      <div className="mt-2 h-4 w-32 animate-pulse rounded bg-divider/60" aria-hidden />
    );
  }

  const { hoursLogged, expectedHoursPerWeek, sessionStates, sessionCount } = summary;
  const hoursStr = hoursLogged > 0 ? `${hoursLogged.toFixed(1)}h` : "0h";

  let chipLabel: string | null = null;
  let chipClass = "";
  if (expectedHoursPerWeek && expectedHoursPerWeek > 0) {
    const ratio = hoursLogged / expectedHoursPerWeek;
    if (ratio > 1.5) {
      chipLabel = "Burnout risk";
      chipClass =
        "bg-[color-mix(in_oklab,var(--pen-pink)_22%,transparent)] text-[color:var(--pen-pink-ink)]";
    } else if (ratio >= 0.9) {
      chipLabel = "On track";
      chipClass =
        "bg-[color-mix(in_oklab,var(--pen-tennis)_18%,transparent)] text-accent-ink";
    } else if (ratio >= 0.5) {
      chipLabel = "Light";
      chipClass =
        "bg-[color-mix(in_oklab,var(--pen-orange)_18%,transparent)] text-attention-ink";
    } else {
      chipLabel = "Behind";
      chipClass =
        "bg-[color-mix(in_oklab,var(--pen-pink)_18%,transparent)] text-[color:var(--pen-pink-ink)]";
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-xs font-bold tabular-nums text-text-primary">
        {hoursStr}
      </span>
      {expectedHoursPerWeek != null && expectedHoursPerWeek > 0 ? (
        <span className="text-[11px] text-text-tertiary tabular-nums">
          / {expectedHoursPerWeek}h goal
        </span>
      ) : (
        <span className="text-[11px] text-text-tertiary">since last lesson</span>
      )}
      {chipLabel ? (
        <span
          className={cn(
            "rounded-pill px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest",
            chipClass,
          )}
        >
          {chipLabel}
        </span>
      ) : null}

      {sessionCount > 0 ? (
        <span
          className="ml-auto flex items-center gap-[3px]"
          aria-label={`${sessionCount} sessions logged`}
        >
          {sessionStates
            .slice()
            .reverse()
            .map((st, idx) => (
              <span
                key={idx}
                className="h-2 w-2 rounded-full"
                style={{
                  background: STATE_COLORS[Math.max(0, Math.min(4, st))],
                  boxShadow:
                    st === 4
                      ? "0 0 4px color-mix(in oklab, var(--pen-tennis) 50%, transparent)"
                      : undefined,
                }}
              />
            ))}
        </span>
      ) : (
        <span className="ml-auto text-[10px] uppercase tracking-widest text-text-tertiary">
          No sessions
        </span>
      )}
    </div>
  );
}
