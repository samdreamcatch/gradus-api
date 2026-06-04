import { cn } from "@/lib/utils";
import type { RosterAthlete } from "@/lib/coach-roster.functions";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(minute: number): string {
  const h24 = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h24 >= 12 ? "p" : "a";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

export function RosterCard({
  athlete,
  onSelect,
}: {
  athlete: RosterAthlete;
  onSelect?: (athleteId: string) => void;
}) {
  const name = `${athlete.firstName} ${athlete.lastName}`.trim();

  return (
    <button
      type="button"
      onClick={() => toast("Athlete detail coming soon")}
      className={cn(
        "group relative block w-full overflow-hidden rounded-2xl border border-divider bg-card p-4 pl-5 text-left shadow-card transition-all",
        "hover:-translate-y-0.5 hover:shadow-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5 bg-[var(--pen-tennis)]"
      />

      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate font-display text-lg font-black leading-tight tracking-tight text-text-primary">
          {name}
        </h2>

        {athlete.slots.length === 0 ? (
          <span className="shrink-0 text-xs text-text-tertiary">No schedule</span>
        ) : (
          <ul className="flex shrink-0 flex-wrap justify-end gap-1">
            {athlete.slots.map((s, i) => (
              <li
                key={i}
                className="rounded-pill border border-divider bg-elevated px-2 py-0.5 text-[11px] font-medium text-text-primary tabular-nums"
              >
                <span className="text-text-secondary">{DAY_SHORT[s.dayOfWeek]}</span>{" "}
                <span>{formatTime(s.startMinute)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </button>
  );
}
