import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { RosterAthlete } from "@/lib/coach-roster.functions";

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
// Render Mon..Sun (treat Sunday=0 as last)
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const HOUR_PX = 44;

interface ScheduleBlock {
  athleteId: string;
  name: string;
  dayIndex: number; // 0..6 (Mon..Sun)
  startMinute: number;
  endMinute: number;
}

function formatTime(minute: number): string {
  const h24 = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h24 >= 12 ? "p" : "a";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

export function WeekScheduleView({ athletes }: { athletes: RosterAthlete[] }) {
  const { blocks, startHour, endHour } = useMemo(() => {
    const blocks: ScheduleBlock[] = [];
    let minStart = 24 * 60;
    let maxEnd = 0;
    for (const a of athletes) {
      const name = `${a.firstName} ${a.lastName}`.trim();
      for (const s of a.slots) {
        const dayIndex = DAY_ORDER.indexOf(s.dayOfWeek);
        if (dayIndex === -1) continue;
        blocks.push({
          athleteId: a.athleteId,
          name,
          dayIndex,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
        });
        if (s.startMinute < minStart) minStart = s.startMinute;
        if (s.endMinute > maxEnd) maxEnd = s.endMinute;
      }
    }
    if (blocks.length === 0) {
      return { blocks, startHour: 8, endHour: 20 };
    }
    const startHour = Math.max(0, Math.floor(minStart / 60) - 1);
    const endHour = Math.min(24, Math.ceil(maxEnd / 60) + 1);
    return { blocks, startHour, endHour };
  }, [athletes]);

  if (blocks.length === 0) {
    return (
      <div className="mt-5 rounded-2xl bg-card p-6 text-center shadow-[0_10px_40px_-12px_rgba(0,0,0,0.15)] sm:p-8">
        <h2 className="font-display text-xl text-text-primary">No sessions scheduled</h2>
        <p className="mt-2 text-sm text-text-secondary">
          When athletes have lesson times set, they'll appear on the calendar here.
        </p>
      </div>
    );
  }

  const hours = endHour - startHour;
  const gridHeight = hours * HOUR_PX;

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-divider bg-card shadow-card">
      <div className="grid" style={{ gridTemplateColumns: "2.25rem repeat(7, minmax(0, 1fr))" }}>
        <div />
        {DAY_LABELS.map((label, i) => (
          <div
            key={i}
            className="border-b border-divider py-2 text-center text-[10px] font-bold uppercase tracking-widest text-text-secondary"
          >
            {label}
          </div>
        ))}

        {/* Time axis */}
        <div className="relative border-r border-divider" style={{ height: gridHeight }}>
          {Array.from({ length: hours }, (_, i) => {
            const hour = startHour + i;
            const ampm = hour >= 12 ? "p" : "a";
            const h12 = hour % 12 === 0 ? 12 : hour % 12;
            return (
              <div
                key={i}
                className="absolute right-1 text-[9px] tabular-nums text-text-tertiary"
                style={{ top: i * HOUR_PX - 4 }}
              >
                {h12}
                {ampm}
              </div>
            );
          })}
        </div>

        {/* Day columns */}
        {DAY_ORDER.map((_, dayIndex) => {
          const dayBlocks = blocks.filter((b) => b.dayIndex === dayIndex);
          return (
            <div
              key={dayIndex}
              className={cn(
                "relative",
                dayIndex < 6 && "border-r border-divider",
              )}
              style={{ height: gridHeight }}
            >
              {/* Hour grid lines */}
              {Array.from({ length: hours }, (_, i) => (
                <div
                  key={i}
                  className="absolute inset-x-0 border-t border-divider/40"
                  style={{ top: i * HOUR_PX }}
                />
              ))}

              {dayBlocks.map((b, i) => {
                const topMin = b.startMinute - startHour * 60;
                const heightMin = Math.max(20, b.endMinute - b.startMinute);
                const firstName = b.name.split(" ")[0] ?? b.name;
                return (
                  <div
                    key={i}
                    title={`${b.name} · ${formatTime(b.startMinute)}–${formatTime(b.endMinute)}`}
                    className="absolute inset-x-0.5 overflow-hidden rounded-md border border-[color:var(--pen-tennis)]/40 bg-[color:var(--pen-tennis)]/15 px-1 py-0.5 text-[10px] font-bold leading-tight text-text-primary"
                    style={{
                      top: (topMin / 60) * HOUR_PX,
                      height: (heightMin / 60) * HOUR_PX - 2,
                    }}
                  >
                    <div className="truncate">{firstName}</div>
                    <div className="truncate text-[9px] font-medium text-text-secondary tabular-nums">
                      {formatTime(b.startMinute)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
