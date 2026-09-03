# Coach post-event linking workflow

## Answer first: where the linking workflow lives today

The "match my athlete to a published skater" flow exists, but it is entirely manual and coach-initiated. Nothing triggers it.

- It lives on the roster, inside an athlete's detail sheet, in the "Competition results" section (`src/components/coach/competition-results-section.tsx`).
- The coach taps **Link results**, picks a finished competition from a list of all recent events, then confirms which published skater is their athlete.
- There is no prompt, badge, or card anywhere telling a coach an event they attended has ended.

Two confirmed reasons Tami sees nothing:

1. The post-event prompt on the authenticated shell is gated to `role === "parent" || role === "athlete"`.
2. Board attendance is never recorded for coaches at all — `recordCompetitionAttendance` loads a parent/athlete viewer and returns early with the comment "Coaches and admins don't get asked for a recap." So even the attendance signal the trigger needs doesn't exist yet for coaches.

The demo data itself is fine: `Gradus Demo Invitational` ended Sep 1, Jamie Gilmore is already linked, two results exist, and the parent recap is in.

## The trigger

A coach opened a live board, and that event has now ended.

```text
coach opens /board/<slug>   ->  attendance recorded for the coach
event ends (ends_on passed) ->  action item on the roster:
                                "Did any of your athletes compete at
                                 Gradus Demo Invitational?"
                             -> Yes  -> pick rostered athlete(s)
                                     -> confirm likely skater matches
                                     -> results link + import
                             -> No   -> dismissed, never asked again
```

No name-guessing happens before the coach says yes — the coach confirms attendance first, then confirms each match, exactly like the existing link sheet's second step.

## What to build

**1. Record coach attendance.** Extend `recordCompetitionAttendance` so a coach opening a board is stored too, tagged with their role. Coaches still get no recap prompt — attendance is only the signal for this workflow.

**2. Roster action item.** On the coach roster (coach home), for each attended competition that has ended within the ask window (7 days, matching the recap window): a card asking "Did any of your athletes compete at {event}?" with **Yes, link athletes** and **No** (dismisses permanently for that coach + event).

**3. Linking flow on Yes.** Opens the existing link sheet preselected to that competition, but starting one step earlier: pick which rostered athletes competed (multi-select from the roster, figure skating only), then for each one confirm the likely skater match from the board — reusing the existing `listSkaterMatches` ranking and `linkAthleteToSkater` confirm step. Athletes already linked to that event are skipped.

**4. Results follow-up.** Once linked, the same card becomes "Results are in for Jamie — Short program 4th · Free skate 2nd" with **Review results**, opening the athlete detail sheet at Competition results where "Generate draft plan" and the protocols already live.

## Technical notes

- `recordCompetitionAttendance`: allow a coach viewer, storing `user_id` + `competition_id` with `athlete_id` null and a `viewer_role` column so the recap query keeps excluding coaches. Migration adds `viewer_role text` to `competition_attendance` (default `'parent'` backfill by lookup) plus a `dismissed_at`-based dismissal, which the table already supports — no new table needed.
- New server fn `getCoachPostEventItems` in `src/lib/competition-results.functions.ts`, `requireSupabaseAuth`: resolve the coach, read their attendance rows for competitions with `ends_on` in the last 7 days and `dismissed_at` null, and for each return the event plus already-linked rostered athletes with their placements and recap flag.
- New server fn `dismissCoachPostEvent` writing `dismissed_at` on the coach's own attendance row.
- New component `src/components/coach/post-event-prompt.tsx` from existing primitives only (`Card variant="section"`, `Button`, `Eyebrow`), shaped like `competition-recap-prompt.tsx` so it reads as the same family of action item.
- Refactor `LinkCompetitionSheet` in `competition-results-section.tsx`: export it, accept an optional preselected `competitionId`, and accept an optional athlete-picker first step so the prompt drives it without duplicating the flow.
- Render on the roster route, not `_authenticated.tsx`, so it never appears over messages or settings.
- Verification after build: reset the demo coach's state so Tami sees the card for `Gradus Demo Invitational`.
