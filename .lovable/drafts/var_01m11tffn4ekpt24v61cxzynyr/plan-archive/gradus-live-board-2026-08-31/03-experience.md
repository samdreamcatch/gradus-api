## What people see

**Scan → `/board/skate-detroit`** (public route, works signed out).

Top of page: competition name, dates, location, a live dot, and "updated 12s ago".

**Rink picker** — a segmented toggle (`ToggleGroup`, the same control used elsewhere)
across the top: `A Rink · B Rink · C Rink`. Defaults to the rink with your skater in
it, otherwise the first live rink.

**One rink panel** on screen, in a `Card`:

- Event name + segment, plus counts (`skater 7 of 24`).
- Three lanes, stacked, each a bordered row inside the card:
  - `JUST SCORED` — pool blue, score large in mono.
  - `ON THE ICE` — accent, name large. Shows "awaiting score" while nothing is posted.
  - `UP NEXT` — orange.
- Idle rink instead shows a countdown to the next event and who won the last one.
- Footer line, always: "On the ice is inferred from the last posted score — IJS does
  not publish who is currently skating, and scores post 1–2 minutes late."

**My skater first** (signed in, parent or athlete): before the rink picker, a pinned
card — "Nora is 4th of 18, on the ice in ~12 minutes" — with a tap through to that
rink. Matching is by first + last name against the start order, case- and
accent-insensitive. A name can be ambiguous, so the match is offered, not assumed: the
first time we find one, the card asks "Is this your skater?" and remembers the answer
per competition. No match, no card, nothing else changes.

**Signed-out extras nudge**: one quiet line under the board — "Sign in to follow your
skater" — nothing blocking.

**History**: `/board` lists competitions you have opened, newest first, with a LIVE
badge while the date range covers today. Entries persist forever; past ones open to a
final-results view.

## Admin

New admin page under Membership → **Competitions**:

- Add a competition: paste the IJS index URL or competition id. Gradus fetches once,
  confirms the name, dates, location and rink list, and you save it with a slug.
- Each row shows the slug, live window, last refresh, last error, and viewer count.
- **QR code** panel (`qrcode.react`, already a dependency) rendering the full
  `https://gradus.training/board/<slug>` URL, sized for print, plus the short typeable
  code as a fallback line under it — same pattern as the guardian invite controls.
- Manual "Refresh now" and an active/archived toggle.
