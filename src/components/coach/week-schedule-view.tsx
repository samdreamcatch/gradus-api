import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RosterAthlete } from "@/lib/coach-roster.functions";

const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

export function WeekScheduleView({ athletes }: { athletes: RosterAthlete[] }) {
  const today = useMemo(() => new Date(), []);
  const currentWeekStart = useMemo(() => startOfWeekMonday(today), [today]);
  const [weekStart, setWeekStart] = useState<Date>(currentWeekStart);

  const weekEnd = addDays(weekStart, 6);
  const isCurrentWeek = sameDay(weekStart, currentWeekStart);

  const sessionsByDay = useMemo(() => {
    // map day index 0..6 where 0=Mon..6=Sun -> DaySession[]
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

  const totalSessions = useMemo(
    () => Array.from(sessionsByDay.values()).reduce((n, arr) => n + arr.length, 0),
    [sessionsByDay],
  );

  return (
    <div className="mt-5">
      {/* Week nav */}
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-divider bg-card p-2 shadow-card">
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

      {totalSessions === 0 ? (
        <div className="mt-4 rounded-2xl bg-card p-6 text-center shadow-card">
          <p className="text-sm text-text-secondary">No sessions scheduled this week.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {Array.from({ length: 7 }, (_, i) => {
            const date = addDays(weekStart, i);
            const sessions = sessionsByDay.get(i) ?? [];
            const isToday = sameDay(date, today);
            return (
              <li
                key={i}
                className={cn(
                  "overflow-hidden rounded-2xl border border-divider bg-card shadow-card",
                  isToday && "ring-1 ring-accent",
                )}
              >
                <div className="flex items-baseline justify-between gap-3 border-b border-divider/60 px-4 py-2">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "font-display text-base font-black text-text-primary",
                        isToday && "text-accent-ink",
                      )}
                    >
                      {DAY_LONG[date.getDay()]}
                    </span>
                    <span className="text-xs text-text-tertiary tabular-nums">
                      {MONTH_SHORT[date.getMonth()]} {date.getDate()}
                    </span>
                    {isToday ? (
                      <span className="rounded-pill bg-accent px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-accent-foreground">
                        Today
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
                    {sessions.length === 0
                      ? "Rest"
                      : `${sessions.length} session${sessions.length === 1 ? "" : "s"}`}
                  </span>
                </div>
                {sessions.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-text-tertiary">No sessions</div>
                ) : (
                  <ul className="divide-y divide-divider/50">
                    {sessions.map((s, j) => (
                      <li
                        key={j}
                        className="flex items-center gap-3 px-4 py-2.5"
                      >
                        <div className="w-16 shrink-0 font-display text-sm font-black tabular-nums text-text-primary">
                          {formatTime(s.startMinute)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-text-primary">
                            {s.name}
                          </div>
                          <div className="text-[11px] text-text-secondary tabular-nums">
                            {formatTime(s.startMinute)} – {formatTime(s.endMinute)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Footnote: this is a recurring weekly view */}
      <p className="mt-4 px-1 text-[10px] uppercase tracking-widest text-text-tertiary">
        Showing recurring weekly lessons · {DAY_SHORT[weekStart.getDay()]} {MONTH_SHORT[weekStart.getMonth()]} {weekStart.getDate()}
      </p>
    </div>
  );
}
