# Lighter mobile load: bundle slimming pass

Goal: cut the initial JavaScript a phone must download and parse before the app is interactive, with zero change to features, routing, or visuals.

## Step 1 — Measure first (no code changes)

Run a production build and record the real chunk table: which modules land in the main entry chunk and how big each is. Everything after this step is driven by that output, not by guesses. If a suspected culprit turns out to be small, it gets dropped from the pass.

## Step 2 — Keep route code out of the entry chunk

Automatic code splitting already separates route components from route loaders, but it only works when route files never `export` their component functions and never import another route's `Route` object. Audit all route files for both patterns and fix any offenders (use `getRouteApi("/path")` instead of importing `Route`).

Also check that shared client modules pulled in by a loader (the `*.functions.ts` client stubs) don't drag heavy UI or data helpers along with them — where they do, move the helper into the component-side module so it lands in the route's lazy chunk.

## Step 3 — Push heavy, rarely-used code behind dynamic imports

Candidates to confirm against Step 1's numbers:

- Charting (recharts, via `components/ui/chart.tsx`) — only admin reporting uses it; load it lazily so no other route pays for it.
- Carousel (embla) and any other single-use UI primitive imported through a shared path.
- Large admin-only modules (admin functions, email copy schema, spreadsheet views) — these should live in admin chunks only, never the entry chunk.
- Big sheets/drawers that mount on interaction (roster add-athlete, join club, schedule editor) — `React.lazy` behind their trigger where they're heavy.
- Confirm the email template modules stay server-only and never reach the browser graph.

## Step 4 — Vendor chunk strategy

Split long-lived vendor code (React, TanStack Router/Query, Supabase, Radix) into its own chunk so app-code deploys don't invalidate it in the service worker cache. Keep it conservative — over-splitting adds request waterfalls on cellular.

## Step 5 — Verify

- Rebuild and compare the chunk table to the Step 1 baseline; report before/after entry-chunk size.
- Load `/coach/plans`, `/parent`, `/athlete`, `/admin` in a headless browser and confirm: no console errors, no new network waterfall, same rendered content.
- Confirm the PWA service worker still precaches correctly after chunk names change.

## Technical notes

- No dependency removals or version changes; this is bundling and import-shape work only.
- `vite.config.ts` may gain a `build.rollupOptions.output.manualChunks` entry for the vendor split. No change to the TanStack Start plugin config.
- Route components must stay unexported; `codeSplitGroupings` used only if a specific route needs its loader bundled with its component.
- Success criterion: measurable drop in entry-chunk bytes with identical behavior on every route.
