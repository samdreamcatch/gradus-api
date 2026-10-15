import type { SessionMoveRating } from "@/lib/plan-sessions.server";
import { stateLabel } from "@/lib/session-states";

/**
 * An each-move check-in in the practice log: every rated move with its own
 * rating, in plan order (a skipped move isn't listed), then the note.
 */
export function SessionMoveRatings({
  ratings,
  note,
}: {
  ratings: SessionMoveRating[];
  note?: string;
}) {
  return (
    <div className="mt-1 space-y-0.5">
      <ul className="space-y-0.5">
        {ratings.map((r, i) => (
          <li key={r.planMoveId ?? `${r.moveName}-${i}`} className="flex items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-text-secondary">{r.moveName}</span>
            <span className="shrink-0 text-text-primary">{stateLabel(r.stateIndex)}</span>
          </li>
        ))}
      </ul>
      {note ? <p className="text-text-secondary">{note}</p> : null}
    </div>
  );
}
