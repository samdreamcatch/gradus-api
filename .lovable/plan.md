# Shared practice log: parent + athlete, with clear attribution

## Where things stand today (verified)

- **Both can already log.** A parent logs a session from the parent plan page and an athlete logs from their own plan page; both write to the same `plan_sessions` rows. Parent-logged rows carry a parent id, athlete-logged rows do not.
- **Both can already see each other's logs at the data level.** Access rules let a parent read every session for their athlete (including athlete-logged ones), an athlete read every session on their own plans (including parent-logged ones), and the coach read everything on their plans.
- **What's missing is the experience.** Nothing in the app lists individual sessions. All three roles only see an aggregate mood bar ("Logged instances") plus, for the coach, an AI summary. There is no date, no duration, no note, and no indication of *who* logged a given practice. The athlete's plan page shows nothing at all about logged sessions.

So: A is already true in the database; B does not exist yet.

## What to build

### 1. One shared "Practice log" list

A single new component used identically by all three roles, placed under the existing "Logged instances" card on the coach plan page and added to the parent and athlete plan pages.

Each row shows:

```text
[TT]  Tami · logged for Addie          Aug 18 · 32 min
      Steady
      "Better edges today, still rushing the entry."
```

- **Who** — the logger's first name. Parent-logged rows read "Tami · logged for Addie"; athlete-logged rows read "Addie · logged herself/themselves" (plain: "Addie · self-logged").
- **A small initials chip** distinguishes logger at a glance, using the existing avatar/chip styling already in the roster and messages UI.
- **When / how long** — date and duration.
- **Mood** — the existing state label (Frustrated → Flowing).
- **Note** — when present.

Newest first, collapsed to the 5 most recent with a "Show all" expander so the page stays short.

### 2. Attribution in the aggregate view

Above the mood bars, add a plain-language line: "12 sessions · 8 logged by Addie, 4 by Tami." Coaches get the split without opening the list.

### 3. Athlete plan page gains the log

The athlete plan detail page currently ends at the moves list. It gets the same "Logged instances" card (mood bars + practice log) the parent and coach see, so the athlete can see what a parent logged on their behalf.

### 4. Double-logging guard

Because both can now log the same practice, add a light warning in the log-session flow when a session for the same plan was already logged in the past 2 hours by the other party: "Tami already logged 32 min on this plan an hour ago — log anyway?" Non-blocking; the person can continue.

## Technical notes

- New server function `listPlanSessions({ planId })` in `src/lib/plan-sessions.functions.ts`, auth-scoped like the existing `getPlanSessions`, returning per-session `{ id, loggedAt, durationSeconds, stateIndex, note, loggedBy: { kind: 'parent' | 'athlete', firstName } }`. Parent name resolved via the row's parent profile, athlete name via the plan's athlete.
- New `src/components/plans/practice-log.tsx` rendering the list; reuses existing card/Eyebrow/state-label primitives and `STATE_LABELS` from `src/lib/session-states.ts`. No new design tokens, no new UI primitives.
- Session counts split by logger added to the existing `getPlanSessions` response so the aggregate line needs no extra request.
- Recent-duplicate check served by the same `listPlanSessions` data already loaded on the page — no new endpoint.
- No schema change and no access-policy change: `plan_sessions` already stores logger identity and already permits cross-visibility.
