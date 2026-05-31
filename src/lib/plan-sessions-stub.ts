// TODO(sessions): Replace with real session feedback table once persisted.
// Deterministic stub keyed off plan id so the chart is stable per plan.

import type { SessionsByState } from "@/components/plans/flow-state-bars";

function hash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function pick(seed: number, max: number): number {
  // Xorshift-ish step
  let s = seed >>> 0;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  return (s >>> 0) % (max + 1);
}

export function stubSessionsForPlan(planId: string): {
  sessionsByState: SessionsByState;
  sessionsTotal: number;
} {
  const base = hash(planId);
  const frustrated = pick(base + 1, 8);
  const pushing = pick(base + 2, 10);
  const steady = pick(base + 3, 14);
  const lockedIn = pick(base + 4, 12);
  const flowing = pick(base + 5, 10);
  const sessionsByState = { frustrated, pushing, steady, lockedIn, flowing };
  const sessionsTotal = frustrated + pushing + steady + lockedIn + flowing;
  return { sessionsByState, sessionsTotal };
}
