
# Lesson Wrap-Up Prompt

After a scheduled lesson ends, the coach gets a prompt asking what to do with that athlete's plan. Works on any coach screen. If they miss it, a persistent banner waits for them.

## Behavior

**Trigger.** Recurring weekly lesson slots already drive the schedule view. A client-side clock ticks every minute and watches for any of *today's* slots whose end time has just passed. When one crosses, a modal pops up:

> **Ana's lesson just ended.**
> Want to update her practice plan?
> [ Edit plan ]   [ Re-deploy ]

- **Edit plan** → navigates to the plan editor for that athlete's active plan (or new-plan flow if none) and closes the modal.
- **Re-deploy** → records that the coach kept the same plan and closes the modal. No plan mutation.
- **Dismiss (X)** → closes the modal but leaves the banner.

**Persistent banner.** If the coach is offline, on another screen, or dismisses the modal without choosing, a slim banner pins above the bottom nav on every coach screen:

> ⏱  Wrap up Ana's lesson →    `Edit`  `Re-deploy`

The banner stays until the coach acts on it or the day ends. If two lessons end without wrap-up, the banner stacks ("Wrap up 2 lessons →") and tapping it opens a small list.

**Once per day.** Each (coach, athlete, lesson-date) pair fires at most once. Acting on it — via modal or banner — marks it handled for the day.

## Placement

| Concern | Lives in |
|---|---|
| Clock + state | New `LessonWrapUpProvider` mounted in the existing `_authenticated.tsx` layout, gated to coach role |
| Modal | Same provider, uses shadcn `AlertDialog` |
| Banner | Same provider, fixed above `CoachBottomNav` so every coach screen inherits it |
| "Edit plan" target | Existing `/coach/plans/$planId` editor (no new screen) |

Your gut was right that this connects roster → plan builder. But because the prompt has to appear on *any* coach screen, the controller belongs in the layout, not on the roster page. The roster's schedule card stays unchanged; it just visually echoes the banner state.

## Data

One new tiny table tracks whether each lesson's wrap-up was handled, so the banner survives reloads and multi-device use.

```text
lesson_wrap_ups
├── id            uuid
├── coach_id      uuid → coach_profiles.id
├── athlete_id    uuid → athletes.id
├── lesson_date   date          -- the day the lesson ended
├── action        text          -- 'edited' | 'redeployed' | 'dismissed'
└── created_at    timestamptz
unique (coach_id, athlete_id, lesson_date)
```

RLS: coaches can read/write their own rows only.

## Server functions

- `getPendingLessonWrapUps()` — returns today's slots whose end time is in the past for this coach and that have no `lesson_wrap_ups` row yet. Each row includes `{ athleteId, athleteName, lessonEndMinute, activePlanId | null }`.
- `recordLessonWrapUp({ athleteId, action })` — upserts the row for today.

The provider calls `getPendingLessonWrapUps` on mount and again every minute (cheap, just a few rows). The minute tick also re-checks locally so the prompt fires *the instant* an end-time passes while the coach is on screen, without waiting for a network round-trip.

## Edge cases handled

- **No active plan** → Edit button routes to the new-plan flow for that athlete.
- **Back-to-back lessons** → modal queues; only one is foregrounded at a time. The banner reflects the queue length.
- **Coach edits the slot mid-day** → next tick re-derives state from the updated slot.
- **Day rollover** → `lesson_date` is per-day, so yesterday's unhandled wrap-ups silently expire (we'll only query today).
- **Time zone** → "today" is computed from the coach's local clock for filtering; the date stored is the coach's local date. Good enough for a weekly-schedule app.

## Technical notes

- `LessonWrapUpProvider` is a client component mounted inside `_authenticated.tsx`. It only does work when the user's role is coach (cheap early return otherwise).
- Polling is a `setInterval(60_000)` for both the local clock check and a `useQuery` with `refetchInterval: 60_000`. No realtime subscription needed — slots don't change minute-to-minute.
- The modal uses our existing `AlertDialog` primitive (already opaque via `bg-popover`, per project memory).
- "Edit plan" navigation uses `useNavigate({ to: "/coach/plans/$planId", params: { planId } })`.
- No changes to existing `plans` or `plan_sessions` tables.

## Out of scope (worth flagging)

- Notifications when the app is closed (push / SMS) — would require service-worker or Twilio work; not part of this plan.
- Tracking *which* edits happened post-lesson vs. otherwise — `action='edited'` just notes the wrap-up was handled via the editor route, not what changed.
- A "snooze 1 hour" option — easy to add later if you want it.
