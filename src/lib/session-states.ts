/** Mood states logged with a practice session, ordered by state_index. */
export const STATE_LABELS = ["Frustrated", "Pushing", "Steady", "Locked in", "Flowing"] as const;

export function stateLabel(index: number | null | undefined): string {
  const i = Math.max(0, Math.min(STATE_LABELS.length - 1, index ?? 0));
  return STATE_LABELS[i]!;
}
