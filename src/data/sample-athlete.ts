/**
 * Sample athlete fixture.
 *
 * A figure skating coach with an empty roster sees Lisa Simpson (Juvenile) and
 * her parent Marge Simpson so the value of the app is visible before a real
 * athlete ever joins. Nothing here touches the database — the objects are
 * shaped exactly like the server functions' return types and are substituted
 * client-side. No server function is ever called with the sample ID.
 */

import type { RosterAthlete } from "@/lib/coach-roster.functions";
import type { AthletePracticeSummary } from "@/lib/coach-schedule.functions";
import type {
  CoachAthleteDetailDTO,
  CoachAthleteAiSummaryDTO,
} from "@/lib/coach-athlete-detail.functions";
import { resolveStarterPrograms } from "./starter-programs";

export const SAMPLE_ATHLETE_ID = "sample-lisa-simpson";
export const SAMPLE_PLAN_ID = "sample-juvenile-plan";
export const SAMPLE_SLOT_ID = "sample-lesson-slot";
export const SAMPLE_SPORT = "figure_skating";

export function isSampleAthlete(athleteId: string | null | undefined): boolean {
  return athleteId === SAMPLE_ATHLETE_ID;
}

const JUVENILE_PROGRAM = resolveStarterPrograms(SAMPLE_SPORT, "juvenile")[0];

/** 9 logged sessions, newest first. 0=frustrated .. 4=flowing */
const SESSION_STATES = [4, 3, 3, 4, 2, 3, 1, 3, 2];

/** Athlete feedback left after each session, newest first. */
export const SAMPLE_SESSION_FEEDBACK: { daysAgo: number; state: number; note: string }[] = [
  { daysAgo: 1, state: 4, note: "Double flip finally felt automatic — landed 6 of 8." },
  { daysAgo: 2, state: 3, note: "Combo spin travelled a little but the change of foot was clean." },
  { daysAgo: 4, state: 3, note: "Worked step sequence with music. Legs tired by the end." },
  { daysAgo: 5, state: 4, note: "Best axel day in weeks. Kept the arms tight." },
  { daysAgo: 8, state: 2, note: "Fly sit spin is still low. Need to sit deeper." },
  { daysAgo: 10, state: 3, note: "Triple sal attempts — two cheated, one close." },
  { daysAgo: 12, state: 1, note: "Rough session, boot felt off and I got frustrated." },
  { daysAgo: 15, state: 3, note: "Solid run-through of the whole program twice." },
  { daysAgo: 18, state: 2, note: "Sit spin positions felt slow but steady." },
];

function roundTo5(n: number): number {
  return Math.round(n / 5) * 5;
}

/**
 * Roster row for Lisa, with a lesson starting within the next hour so the
 * "Up next briefing" card is visible the moment the coach opens the app.
 */
export function buildSampleRosterAthlete(now: Date = new Date()): RosterAthlete {
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  // 20–25 minutes out, clamped so the lesson always lands inside today.
  const startMinute = Math.min(roundTo5(nowMinute + 20), 22 * 60 + 45);
  const endMinute = Math.min(startMinute + 45, 23 * 60 + 55);

  return {
    athleteId: SAMPLE_ATHLETE_ID,
    firstName: "Lisa",
    lastName: "Simpson",
    sport: SAMPLE_SPORT,
    parentFirstName: "Marge",
    parentLastName: "Simpson",
    selfManaged: false,
    slots: [
      {
        id: SAMPLE_SLOT_ID,
        dayOfWeek: now.getDay(),
        startMinute,
        endMinute,
        overrides: [],
      },
    ],
    otherCoachCount: 0,
    otherCoachLastName: null,
  };
}

export function buildSamplePracticeSummary(): AthletePracticeSummary {
  return {
    athleteId: SAMPLE_ATHLETE_ID,
    hoursLogged: 6.5,
    expectedHoursPerWeek: 8,
    seasonGoalLabel: "Intermediate",
    sessionStates: SESSION_STATES.slice().reverse(), // oldest → newest, as the server returns
    sessionCount: SESSION_STATES.length,
    windowDays: 7,
  };
}

function sessionsByState() {
  const counts = { frustrated: 0, pushing: 0, steady: 0, lockedIn: 0, flowing: 0 };
  const keys = ["frustrated", "pushing", "steady", "lockedIn", "flowing"] as const;
  for (const s of SESSION_STATES) counts[keys[Math.max(0, Math.min(4, s))]] += 1;
  return counts;
}

export function buildSampleAthleteDetail(): CoachAthleteDetailDTO {
  return {
    athleteId: SAMPLE_ATHLETE_ID,
    firstName: "Lisa",
    lastName: "Simpson",
    parentFirstName: "Marge",
    parentLastName: "Simpson",
    selfManaged: false,
    coachedSports: [{ key: SAMPLE_SPORT, label: "Figure Skating" }],
    goals: [
      {
        sport: SAMPLE_SPORT,
        sportLabel: "Figure Skating",
        currentLevelLabel: "Juvenile",
        seasonGoalLabel: "Intermediate",
        longTermGoal:
          "Pass the Intermediate free skate test this season and qualify for regionals next year. Land a consistent double axel by spring.",
      },
    ],
    plans: [
      {
        planId: SAMPLE_PLAN_ID,
        title: JUVENILE_PROGRAM?.title ?? "Juvenile — Free Skate",
        status: "active",
        isGradus: true,
        sessionsByState: sessionsByState(),
        sessionsTotal: SESSION_STATES.length,
      },
    ],
    activity: {
      practiceMinutesMine: 390,
      practiceMinutesTotal: 585,
      lessonMinutesTotal: 180,
    },
    hasAnySignal: true,
    windowDays: 30,
    otherCoaches: [],
  };
}

export function buildSampleAiSummary(): CoachAthleteAiSummaryDTO {
  return {
    summary:
      "Lisa logged 9 practices in the last 30 days, 6.5 hours in the past week against an 8-hour Juvenile target. Seven of nine sessions were logged as steady or better, with two flow sessions in the past five days tied to the double flip and axel. The two low sessions both mention the fly sit spin and one boot-fit complaint.",
    verdict: "increase",
    rationale:
      "Jump work is trending up with back-to-back flow sessions, while spin quality is the repeated sticking point — a good week to raise the spin demand.",
    empty: false,
  } as CoachAthleteAiSummaryDTO;
}

export function buildSampleBriefing(): string {
  return [
    "Since your last lesson Lisa logged 9 practices — 6.5 hours this week against her 8-hour Juvenile target.",
    "Jumps are trending up: her two most recent sessions were her strongest of the month, with the double flip landed 6 of 8 attempts and a clean axel day where she noted keeping her arms tight.",
    "Spins are the repeated sticking point. She flagged the fly sit spin as too low, and the change-foot combo spin travelled in her most recent attempt.",
    "One rough session 12 days ago was attributed to boot fit rather than skill — worth a quick check-in before you start.",
    "Her season goal is passing the Intermediate free skate test; triple salchow attempts are still cheating on the takeoff.",
  ].join("\n\n");
}
