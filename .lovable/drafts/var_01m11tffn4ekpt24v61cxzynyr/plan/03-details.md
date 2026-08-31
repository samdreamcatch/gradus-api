## Technical detail

### Data (`src/lib/ijs-scrape.server.ts`, `src/lib/board-refresh.server.ts`, `src/lib/board-types.ts`)

- `buildPayload` currently narrows `dated` to a single day before building `schedule`.
  Change: keep the whole competition's events in `schedule`, each tagged with `dayLabel`
  (the index page's date cell) and `dayKey` (venue-local `YYYY-MM-DD`). The rink lanes,
  `justFinished` and `next` logic stay scoped to the current day exactly as now.
- `BoardSkater.place` is filled from `segPlace`. Add `finalPlace` from the parser's overall
  `place` column and `segScores: { segment: string; score: string; place: string }[]` for
  combined events, so standings can sort by overall result and show each segment.
- `BoardEvent` gains `dayLabel`, `dayKey`, and `standings: BoardSkater[]` — the same rows as
  `results`, sorted by numeric `finalPlace` (unplaced rows last). No extra fetch: it is a
  sort of data already parsed.
- Fetch cost: `orders` is already keyed `file:status`, so each finished event is fetched
  once for the whole competition and then served from cache; only live/scheduled events on
  the current day re-fetch on the 30s cycle. Protocols stay limited to the existing
  3-hour window so the cached snapshot does not grow without bound.

### Client (`src/routes/board.$slug.tsx`, `src/components/board/*`)

- `schedule-board.tsx`: derive the day list from `dayKey`, render existing `Chip`s as the
  day picker (default = day containing the current live/next event), filter rows by the
  selected day, and change the row action from "select this rink" to "open results". Rink
  selection stays reachable from the Rinks tab.
- New `src/components/board/event-results.tsx`: a bottom `Sheet` (same shell as
  `score-sheet.tsx`) listing standings — placement, medal `Tag` for 1/2/3, name, club,
  segment scores and total in mono tabular figures. Rows with a posted protocol are
  buttons that open the existing `ScoreSheet`; the results sheet stays mounted underneath.
- Live events open the same sheet with an "in progress" `Tag` and standings so far.
- `board-demo.ts` gains a second day and one finished event with full standings so the
  whole flow is visible at `/board/demo` before real data exists.
- Accessibility: day chips are a radiogroup with `aria-checked`; standings rows keep the
  44px minimum target and carry a composed label ("first place, Ava Lin, 98.42").

### Out of scope

- No cross-competition history changes; the local visited-boards list is untouched.
- No push notifications, no new statuses.
