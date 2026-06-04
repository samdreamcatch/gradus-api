import { toast } from "sonner";
import { getSport, type SportKey } from "@/lib/coach-sports";
import type { RosterAthlete } from "@/lib/coach-roster.functions";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(minute: number): string {
  const h24 = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h24 >= 12 ? "p" : "a";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function sportLabel(sport: string | null): string | null {
  if (!sport) return null;
  return getSport(sport as SportKey)?.label ?? sport;
}

export function RosterCard({ athlete }: { athlete: RosterAthlete }) {
  const name = `${athlete.firstName} ${athlete.lastName}`.trim();
  const parentName = `${athlete.parentFirstName} ${athlete.parentLastName}`.trim();
  const sport = sportLabel(athlete.sport);

  return (
    <button
      type="button"
      onClick={() => toast("Athlete detail coming soon")}
      className="block w-full rounded-2xl bg-card p-5 text-left shadow-[0_10px_40px_-12px_rgba(0,0,0,0.15)] transition hover:shadow-[0_14px_44px_-12px_rgba(0,0,0,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:p-6"
    >
      {sport ? (
        <p className="text-[10px] font-bold uppercase tracking-widest text-accent-ink">
          {sport}
        </p>
      ) : null}
      <h2 className="mt-1 font-display text-2xl font-medium leading-tight text-text-primary">
        {name}
      </h2>
      {parentName ? (
        <p className="mt-1 font-hand text-lg text-text-secondary">
          with {parentName}
        </p>
      ) : null}

      <div className="mt-4">
        {athlete.slots.length === 0 ? (
          <p className="text-sm text-text-tertiary">No schedule set</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {athlete.slots.map((s, i) => (
              <li
                key={i}
                className="rounded-pill border border-divider bg-elevated px-2.5 py-1 text-xs font-medium text-text-primary"
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
