/**
 * The demo athlete's recent activity (Admin → Membership → Demo accounts).
 *
 * Practice sessions and a short conversation, dated relative to "now". The
 * coach's pre-lesson briefing (pre-lesson-briefing.server.ts) reads the 14
 * days before a lesson, or back to the last wrap-up, so a seed dated only at
 * creation goes blank after two weeks. "Refresh activity" moves these same
 * rows back to recent dates instead of adding more: each one is found again
 * by its text, so every note and body here must be unique and non-empty.
 * Three texts are the original seed's, so accounts seeded before this keep
 * their rows.
 */

export type DemoSession = {
  daysAgo: number;
  hourUtc: number;
  minutes: number;
  /** `STATE_LABELS` index: 0 Frustrated … 4 Flowing. */
  state: number;
  note: string;
};

/** Newest first: a rough start that settles into "Locked in". */
export const DEMO_SESSIONS: DemoSession[] = [
  { daysAgo: 1, hourUtc: 23, minutes: 30, state: 3, note: "Salchow landed 6 of 8." },
  {
    daysAgo: 2,
    hourUtc: 22,
    minutes: 25,
    state: 2,
    note: "Two clean run-throughs of the waltz jump sequence.",
  },
  { daysAgo: 4, hourUtc: 23, minutes: 15, state: 1, note: "Tired after school." },
  {
    daysAgo: 6,
    hourUtc: 22,
    minutes: 30,
    state: 3,
    note: "Spin stayed centered for the first time all week.",
  },
  { daysAgo: 9, hourUtc: 23, minutes: 25, state: 2, note: "Worked on salchow takeoff edges." },
  {
    daysAgo: 12,
    hourUtc: 22,
    minutes: 20,
    state: 0,
    note: "Kept two-footing the salchow landing.",
  },
];

export type DemoMessage = {
  daysAgo: number;
  hourUtc: number;
  minute: number;
  sender: "coach" | "parent" | "athlete";
  body: string;
};

/** Oldest first, as the thread reads. */
export const DEMO_MESSAGES: DemoMessage[] = [
  {
    daysAgo: 12,
    hourUtc: 15,
    minute: 0,
    sender: "coach",
    body: "Welcome to Gradus! Your first plan is up — three moves, about eight minutes. Log a session after each practice.",
  },
  {
    daysAgo: 9,
    hourUtc: 20,
    minute: 30,
    sender: "parent",
    body: "Thanks Jordan. Sam practised Tuesday and Thursday this week.",
  },
  {
    daysAgo: 5,
    hourUtc: 16,
    minute: 10,
    sender: "coach",
    body: "Great to see the logs coming in. Keep the run-throughs clean before adding speed.",
  },
  {
    daysAgo: 3,
    hourUtc: 21,
    minute: 5,
    sender: "parent",
    body: "Sam is wiped out after school some days. Is a shorter session OK then?",
  },
  {
    daysAgo: 3,
    hourUtc: 21,
    minute: 40,
    sender: "coach",
    body: "Yes, 15 minutes is plenty on those days.",
  },
  {
    daysAgo: 1,
    hourUtc: 23,
    minute: 45,
    sender: "athlete",
    body: "The salchow felt way better today!",
  },
];

/** `daysAgo` whole UTC days before `now`, at the given UTC time: always in the past for daysAgo ≥ 1. */
export function demoTimestamp(now: Date, daysAgo: number, hourUtc: number, minute = 0): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hourUtc, minute, 0, 0);
  return d.toISOString();
}
