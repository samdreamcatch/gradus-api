# Live Board v2 — the arrivals board

Five changes, all inside the existing board route and design system.

## 1. A full-day schedule ("departures board")

The board gets two tabs: **Now** (today's rink panels, what exists now) and **Schedule**.

Schedule is one time-ordered list of every event of the day, styled like an airport
departures board: time, event name, rink, and a status tag — SCHEDULED, LIVE, or FINAL.
Rows where one of your skaters competes are marked with the accent pen and float to
your attention with a small "YOUR SKATER" tag. Tapping a row jumps to that rink and
event on the Now tab.

## 2. Your skater's event is named

The "your skater" card becomes a compact board of its own — one row per followed
skater, showing name, event and segment, rink, start position ("skates 9 of 12"),
scheduled time, and a live status line: *warming up · 3 skaters ahead · ~14 min*,
then *ON THE ICE*, then their score and placement once posted.

## 3. Tap a scored skater to see the full protocol

Every scored skater becomes tappable, opening a Sheet with the judged breakdown:
total score, technical elements score, factored program components, deductions,
the element-by-element table (base value, GOE, score) and the component table with
factors. This all comes from the same event page already being fetched — the
detail rows are in the HTML, just hidden.

## 4. Coaches (and parents) can track several skaters

Already true in the data: the board asks the backend for the athletes the signed-in
person can see, which for a coach is their whole roster. Only the UI limited it to one
match. All matched skaters now appear, sorted by who skates soonest.

## 5. Airline-style live feel

- Status tags and countdowns in the mono face, like a flight board.
- A **Follow** toggle on each of your skaters, remembered on the device.
- When a followed skater's row changes state (score posts, moves to on-ice, event
  goes live) the row briefly highlights, so a glance tells you what changed.

Push notifications are not part of this round — the Follow toggle stores the intent
so notifications can be switched on later without changing the UI.
