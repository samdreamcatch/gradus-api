## Technical notes

**Data**

Two new tables (applied when the draft is accepted):

- `competitions` — id, slug, ijs_base_url, comp_id, year, name, dates_label, location,
  starts_on, ends_on, active, created_at. Public `SELECT` to `anon` (nothing private
  here); writes admin-only.
- `competition_snapshots` — competition_id (pk), payload jsonb, generated_at,
  error text, fetch_count. Public `SELECT` to `anon`; writes service-role only.

GRANTs and RLS in the same migration. No personal data is stored — the payload is
public results already published by USFS.

**Server**

- `src/lib/ijs-scrape.server.ts` — a TypeScript port of the Python parser: index
  parse, event parse (cells read by CSS class, never index), withdrawal exclusion,
  segment-column matching by name, venue caching, lane inference. Decoding uses
  `TextDecoder("windows-1252")` on the raw bytes, with a byte-map fallback, because
  the pages are latin-1 and UTF-8 mangles accented names.
- `src/lib/board.functions.ts` — public `getBoard({ slug })`. Reads the snapshot; if it
  is older than 30s and the competition is live, it triggers a refresh and returns the
  refreshed payload, guarded so concurrent readers do not stampede (a
  `generated_at`-conditional update acts as the lock). Outside the competition window
  it just returns the last snapshot.
- `src/routes/api/public/board/refresh.ts` — the same refresh, callable by a scheduler,
  so a board stays warm even with nobody polling. Secret-header guarded.
- Admin functions: `upsertCompetition`, `listCompetitions`, `refreshNow` — all
  `requireSupabaseAuth` + `has_role(admin)`.

Roughly 4 upstream requests per refresh once venues are cached, shared across all
viewers.

**Client**

- `src/routes/board.index.tsx` and `src/routes/board.$slug.tsx` — public routes with
  their own `head()` metadata. Data via `useQuery` with `refetchInterval: 30_000`,
  paused when the tab is hidden and while the competition is not live.
- History is kept in `localStorage` for signed-out visitors; no new table.
- No new components, no new CSS. Existing `Card`, `ToggleGroup`, `Tag`, `Chip`,
  `Separator`, `Eyebrow`, `Sheet`, `Skeleton`, and the semantic tokens only. Numbers
  use `font-mono` with `tabular-nums`.

**Failure behavior**

If USFS is unreachable or the page shape changes, the board keeps showing the last
good snapshot with a quiet "last updated HH:MM" line rather than an error screen, and
the parse error is recorded on the admin row so you can see it.

## Out of scope for this pass

Push notifications when your skater is up, non-IJS sports, and any writing back to
USFS. Say the word and they become a phase 2.
