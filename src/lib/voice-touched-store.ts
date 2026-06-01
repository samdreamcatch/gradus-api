// Tiny module-level store so that voice-FAB results created from the
// plans list can hand off their "touched" diff highlights to the editor
// route that mounts immediately afterward. Lives only for ~1 navigation,
// then is consumed.

import type { VoiceSources } from "./voice-types";

export interface VoiceTouchedSnapshot {
  plan: { title?: boolean; athleteId?: boolean; notes?: boolean };
  moves: Record<string, string[]>;
  newMoveIds: string[];
  transcript?: string;
  sources?: VoiceSources;
}

const pending = new Map<string, VoiceTouchedSnapshot>();

export function stashVoiceTouched(planId: string, snap: VoiceTouchedSnapshot) {
  pending.set(planId, snap);
  setTimeout(() => pending.delete(planId), 30_000);
}

export function consumeVoiceTouched(planId: string): VoiceTouchedSnapshot | null {
  const v = pending.get(planId);
  if (v) pending.delete(planId);
  return v ?? null;
}
