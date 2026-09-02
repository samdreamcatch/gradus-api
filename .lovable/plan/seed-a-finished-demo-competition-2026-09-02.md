# Seed a finished demo competition

Goal: sign in as Tami Taylor (coach) or parent@test.dev and immediately see the
"the event just ended" experience — without scanning anything, and without the
app trying to fetch a real competition website.

## What gets created

One demo competition, "Gradus Demo Invitational", dated so it **ended
yesterday**. It is data only — no code changes, no schema changes.

Around it:

1. **A finished scoreboard** — a stored snapshot with final placements and
   scores, including a skater named Jamie Gilmore. Because the snapshot is
   stored, opening the board never tries to reach an outside results site.
2. **Parent side** — a board visit recorded for parent@test.dev, as if they had
   scanned the QR code at the rink. Since the event is over and inside the
   7-day ask window, signing in as that parent shows the "How did Gradus Demo
   Invitational go?" recap card at the top of the app, with Jamie already
   resolved as the skater. Writing the recap sends it to Jamie's coaches as a
   message, exactly as it would in production.
3. **Coach side** — Jamie is already linked to her skater in that competition,
   with two saved segments (short program and free skate) including full
   judging protocols. Opening Jamie from Tami's roster shows the Competition
   results section populated: placements, scores, a tap-through score sheet,
   the parent's recap once written, and the "Draft a plan from these results"
   button ready to run.

## What it will look like

```text
Parent (parent@test.dev)        Coach (Tami Taylor)
--------------------------      -----------------------------
[card] How did Gradus Demo      Roster > Jamie Gilmore
Invitational go?                  Competition results
  Write recap / Not now            Gradus Demo Invitational
                                   Short Program  4th  54.18
     writes recap ------------->   Free Skate     3rd  82.40
     (also arrives as a              [Draft a plan from results]
      message to her coaches)        Recap from parent: "..."
```

## Notes and choices

- The competition is marked inactive/past, so it will not appear as a live
  board and never triggers a refresh against an external site.
- Only parent@test.dev gets the recap prompt. Say the word and I'll also seed
  the visit for Jamie's own athlete login (athlete6@test.dev) so you can see
  the athlete-authored version of the same card.
- Everything is a normal row, so re-running or deleting it later is trivial —
  removing the competition removes the snapshot, the link, the results, the
  visit record, and any recap with it.

## Technical details

- Applied with the data tool (INSERT only): `competitions` (slug
  `gradus-demo-invitational`, `starts_on` = 2 days ago, `ends_on` = yesterday,
  `active = false`, a placeholder `ijs_base_url` that is never fetched because
  a payload exists), `competition_snapshots` (final `payload` in the existing
  `BoardPayload` shape plus a `skater_index` stamped fresh),
  `competition_attendance` (user_id = parent@test.dev's auth user,
  `athlete_id` = Jamie), `athlete_competition_skaters` (Jamie ↔ "Jamie
  Gilmore", `linked_by` = Tami's user), and two
  `athlete_competition_results` rows with `protocol` JSON shaped like
  `SkaterProtocol` so `ScoreSheet` renders.
- IDs used: athlete Jamie Gilmore `5666dde4…`, coach Tami Taylor `e82ce1b6…`,
  parent user `36f75b57…` — all confirmed present, with Tami rostering Jamie
  and Jamie carrying `figure_skating`, which is what the recap prompt's
  single-athlete resolution depends on.
- `getBoard` only re-fetches when the payload is missing or the event is inside
  its live window; both are false here.
- `generatePlanFromResults` still runs live against the stored protocols, so
  the draft-plan path is exercised for real.
