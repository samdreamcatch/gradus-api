## Technical detail

### Data (server side, `src/lib/ijs-scrape.server.ts` + `board-refresh.server.ts`)

- `BoardPayload` gains `schedule: BoardEvent[]` — one entry per event on the current
  competition day, from the index page the refresher already fetches: time label,
  start instant, event name, IJS status, and the rink when known (the rink/venue
  only appears on the event page, so it is filled in for events already fetched and
  cached per event file thereafter; unfetched future events show a blank rink until
  their page is opened).
- A row is `DELAYED` when its start instant has passed, its status is not final, and
  no score has posted for it.
- The event page parser gains `parseProtocol`: the `TR class=child` rows already in
  the same HTML carry `detailScoreSum` (total, executed elements, factored components,
  deductions), `detailScoreElm` (planned/executed element, base value, GOE, score) and
  `detailScoreCmp` (component, unfactored score, factor). Each scored skater in the
  payload gains an optional `protocol` object. Only events already being fetched are
  parsed, so no extra upstream requests.
- Payload stays one cached JSON per competition, refreshed on the existing shared
  30-second cycle — no per-viewer fetching.

### Client (`src/routes/board.$slug.tsx`, `src/components/board/*`)

- Tabs via the existing segmented control pattern; tab state in component state.
- New `schedule-board.tsx` renders the departures list with `Tag` for status and mono
  tabular figures for times. Tapping a row selects that rink and switches to Now.
- New `my-skaters.tsx` replaces the single-match card: matches every name from
  `getMySkaterNames` against every event's start order (not just the live one), so a
  coach's whole roster appears, ordered by soonest ice time. Each row has a `Follow`
  toggle persisted to `localStorage` under `gradus.boardFollow.<slug>`.
- New `score-sheet.tsx` — a Sheet showing the protocol tables using existing table and
  typography tokens, opened by tapping any scored skater in a lane, in the schedule, or
  in the my-skaters board.
- Change highlight: the query already refetches every 30s; a small hook diffs the
  previous payload for followed skaters and applies a brief accent wash to changed rows.
- Demo board (`src/lib/board-demo.ts`) gains a sample full-day schedule and one sample
  protocol so all of this is visible at `/board/demo` before the migration is accepted.

### Not in this round

- Sending push notifications (`device_tokens` exists; the send side does not).
- Cross-day history — the board stays on the competition's current day.
