/** Mood states logged with a practice session, ordered by state_index. */
export const STATE_LABELS = ["Frustrated", "Pushing", "Steady", "Locked in", "Flowing"] as const;

export function stateLabel(index: number | null | undefined): string {
  const i = Math.max(0, Math.min(STATE_LABELS.length - 1, index ?? 0));
  return STATE_LABELS[i]!;
}

/** "Aug 18 · 32 min" — right-hand meta for one logged session. */
export function sessionMetaLabel(loggedAt: string, durationSeconds: number): string {
  const date = new Date(loggedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const mins = Math.round((durationSeconds ?? 0) / 60);
  return mins > 0 ? `${date} · ${mins} min` : date;
}

/** "Tami logged for Addie" / "Addie logged this". */
export function sessionLoggerLabel(
  loggedByKind: "parent" | "athlete",
  loggedByFirstName: string,
  athleteFirstName: string,
): string {
  return loggedByKind === "parent"
    ? `${loggedByFirstName} logged for ${athleteFirstName}`
    : `${loggedByFirstName} logged this`;
}

/** "12 sessions · 8 logged by Addie, 4 by Tami" */
export function sessionAttributionLine(args: {
  total: number;
  loggedByAthlete: number;
  loggedByParent: number;
  athleteFirstName: string;
}): string {
  const { total, loggedByAthlete, loggedByParent, athleteFirstName } = args;
  const base = `${total} session${total === 1 ? "" : "s"}`;
  if (total === 0) return base;
  if (loggedByParent === 0) return `${base} · all logged by ${athleteFirstName}`;
  if (loggedByAthlete === 0) return `${base} · all logged by a parent`;
  return `${base} · ${loggedByAthlete} logged by ${athleteFirstName}, ${loggedByParent} by a parent`;
}

