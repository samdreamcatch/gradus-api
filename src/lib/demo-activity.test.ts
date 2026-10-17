import { describe, expect, it } from "bun:test";
import { DEMO_MESSAGES, DEMO_SESSIONS, demoTimestamp } from "./demo-activity";
import { STATE_LABELS } from "./session-states";

const DAY = 24 * 60 * 60 * 1000;
// The briefing's window with no earlier wrap-up (pre-lesson-briefing.server.ts).
const WINDOW = 14 * DAY;

describe("demo activity", () => {
  // Midnight, midday and just before midnight UTC.
  const nows = ["2026-10-17T00:05:00Z", "2026-10-17T12:00:00Z", "2026-10-17T23:55:00Z"].map(
    (s) => new Date(s),
  );

  it("dates every session and message inside the briefing window, never in the future", () => {
    for (const now of nows) {
      const stamps = [
        ...DEMO_SESSIONS.map((s) => demoTimestamp(now, s.daysAgo, s.hourUtc)),
        ...DEMO_MESSAGES.map((m) => demoTimestamp(now, m.daysAgo, m.hourUtc, m.minute)),
      ].map((iso) => new Date(iso).getTime());
      for (const t of stamps) {
        expect(t).toBeLessThan(now.getTime());
        expect(now.getTime() - t).toBeLessThan(WINDOW);
      }
    }
  });

  it("keeps a session and a message after yesterday's wrap-up", () => {
    // A wrap-up yesterday starts the window at yesterday's date.
    expect(DEMO_SESSIONS.some((s) => s.daysAgo === 1)).toBe(true);
    expect(DEMO_MESSAGES.some((m) => m.daysAgo === 1)).toBe(true);
  });

  it("gives every row unique, non-empty text so a refresh finds it again", () => {
    const notes = DEMO_SESSIONS.map((s) => s.note);
    const bodies = DEMO_MESSAGES.map((m) => m.body);
    expect(new Set(notes).size).toBe(notes.length);
    expect(new Set(bodies).size).toBe(bodies.length);
    for (const t of [...notes, ...bodies]) expect(t.trim().length).toBeGreaterThan(0);
  });

  it("uses flow states on the canonical scale", () => {
    for (const s of DEMO_SESSIONS) {
      expect(s.state).toBeGreaterThanOrEqual(0);
      expect(s.state).toBeLessThan(STATE_LABELS.length);
      expect(s.minutes).toBeGreaterThan(0);
    }
  });
});
