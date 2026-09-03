# Move competition recaps out of the athlete card

Recaps written by a parent or athlete after an event already get posted into the coach conversation as a message. Today they are *also* pinned onto the athlete card as a separate "Competition recaps" block. That block goes away; the message stays, and the recap becomes part of what the 30-day AI summary reads.

## What changes

1. **Athlete card** — remove the "Competition recaps" section from the competition results area of the athlete detail sheet. Nothing else in that section changes (link-to-skater, protocol scores, score sheet all stay).
2. **Messages** — no new work: the recap is already delivered to the selected coaches' conversations with the event name in the body. It now becomes the only place a coach reads it.
3. **Last-30-days summary** — the coach's AI summary already ingests parent/athlete messages from the last 30 days, so a recap sent today is picked up automatically. To make sure the model treats it as a competition report rather than a stray message, recaps are pulled in explicitly and labelled in the prompt as competition recaps, alongside practice logs and messages, and the recap message itself is de-duplicated so it isn't counted twice.

## Technical notes

- `src/components/coach/competition-results-section.tsx`: delete the `CompetitionRecaps` component, its render site, and the now-unused `getAthleteCompetitionRecaps` / query imports.
- `src/lib/coach-athlete-detail.functions.ts` (`getCoachAthleteAiSummary`): add a read of `competition_recaps` for the athlete within the 30-day window (joined to `competitions` for the event name), render a `COMPETITION RECAPS` block in the prompt, drop message rows whose body matches a recap so it appears once, and include recaps in the `hasAnySignal` / empty-state check so a recap alone can produce a summary.
- `getAthleteCompetitionRecaps` stays in place — it is the read path the summary will use server-side and is still useful for future surfaces.
