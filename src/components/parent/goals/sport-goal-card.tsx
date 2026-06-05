import { getSport, getSportLevel } from "@/lib/coach-sports";
import type { ParentGoalSportDTO } from "@/lib/parent-goals.functions";
import { IntensityLadder, type LadderStop } from "./intensity-ladder";
import { PracticeRing } from "./practice-ring";
import { StatusPill, type GoalStatus } from "./status-pill";

function computeStatus(g: ParentGoalSportDTO): {
  status: GoalStatus;
  lower: number | null;
  upper: number | null;
} {
  if (g.hoursAtCurrent == null && g.hoursAtGoal == null) {
    return { status: "unset", lower: null, upper: null };
  }
  const a = g.hoursAtCurrent ?? g.hoursAtGoal!;
  const b = g.hoursAtGoal ?? g.hoursAtCurrent!;
  const lower = Math.min(a, b);
  const upper = Math.max(a, b);

  // Building up: no sessions yet, or first session less than 28 days ago AND under lower bound
  const isNewish =
    !g.firstSessionAt ||
    Date.now() - new Date(g.firstSessionAt).getTime() < 28 * 24 * 60 * 60 * 1000;
  if (g.sessionsCount === 0) return { status: "building", lower, upper };
  if (g.loggedHoursPerWeek < lower && isNewish) {
    return { status: "building", lower, upper };
  }
  if (g.loggedHoursPerWeek < lower) return { status: "behind", lower, upper };
  if (g.loggedHoursPerWeek > upper) return { status: "over", lower, upper };
  return { status: "onTrack", lower, upper };
}

function buildLadder(sport: string, currentKey: string, goalKey: string): LadderStop[] {
  const s = getSport(sport);
  if (!s) return [];
  const idxs = s.levels.map((l) => l.key);
  const ci = idxs.indexOf(currentKey);
  const gi = idxs.indexOf(goalKey);
  if (ci < 0 || gi < 0) return [];
  const lo = Math.max(0, Math.min(ci, gi) - 1);
  const hi = Math.min(s.levels.length - 1, Math.max(ci, gi) + 1);
  return s.levels.slice(lo, hi + 1).map((l) => ({ key: l.key, label: l.label }));
}

export function SportGoalCard({ goal }: { goal: ParentGoalSportDTO }) {
  const sport = getSport(goal.sport);
  const current = getSportLevel(goal.sport, goal.currentLevelKey);
  const seasonGoal = getSportLevel(goal.sport, goal.seasonGoalKey);
  const { status, lower, upper } = computeStatus(goal);

  const stops = buildLadder(goal.sport, goal.currentLevelKey, goal.seasonGoalKey);

  // Levels-away copy
  const levels = sport?.levels ?? [];
  const ci = levels.findIndex((l) => l.key === goal.currentLevelKey);
  const gi = levels.findIndex((l) => l.key === goal.seasonGoalKey);
  const distance = ci >= 0 && gi >= 0 ? Math.abs(gi - ci) : null;

  

  const bandText =
    lower != null && upper != null
      ? lower === upper
        ? `${lower} hr/wk`
        : `${lower}–${upper} hr/wk`
      : "Not yet set";

  return (
    <article className="rounded-2xl border border-divider bg-card p-5 shadow-sm">
      <header className="mb-1 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
          Working toward
        </p>
        {sport && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
            {sport.label}
          </span>
        )}
      </header>

      <h3 className="text-xl font-bold text-text-primary">
        {seasonGoal?.label ?? goal.seasonGoalKey}
      </h3>
      <p className="mt-1 text-sm text-text-secondary">
        Currently {current?.label ?? goal.currentLevelKey}
        {distance != null && distance > 0
          ? ` · ${distance} level${distance === 1 ? "" : "s"} to go`
          : distance === 0
            ? " · at target level"
            : ""}
      </p>

      {stops.length > 0 && (
        <IntensityLadder
          stops={stops}
          currentKey={goal.currentLevelKey}
          goalKey={goal.seasonGoalKey}
        />
      )}

      <div className="mt-5 border-t border-divider pt-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
          THIS MONTH&apos;S AVERAGE PRACTICE
        </p>
        <div className="mt-2 flex items-center gap-4">
          <PracticeRing
            hours={goal.loggedHoursPerWeek}
            targetLower={lower}
            targetUpper={upper}
            status={status}
          />
          <div className="min-w-0 flex-1">
            <StatusPill status={status} />
            <p className="mt-2 text-sm text-text-primary">
              Target band: <span className="font-semibold">{bandText}</span>
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              4-week trailing average · {goal.sessionsCount} session
              {goal.sessionsCount === 1 ? "" : "s"} logged
            </p>
          </div>
        </div>
      </div>

      {goal.longTermGoal.trim().length > 0 && (
        <div className="mt-5 border-t border-divider pt-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            Long-term goal
          </p>
          <p className="mt-1 font-hand text-lg leading-snug text-text-primary">
            “{goal.longTermGoal}”
          </p>
        </div>
      )}
    </article>
  );
}
