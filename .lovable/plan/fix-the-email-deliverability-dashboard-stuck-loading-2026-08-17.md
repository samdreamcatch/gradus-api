# Fix the Email deliverability dashboard stuck loading

## What's wrong

The dashboard recomputes its time window from the current clock on every render, with no memoization. That window is part of the query's cache key, so every render produces a brand-new key, which starts a fresh fetch, which re-renders, and so on. The page never settles out of its loading state, and any data that does arrive is discarded immediately.

## The fix

1. Freeze the time window per filter selection
   - Compute the start/end timestamps once per range/from/to selection (memoized), instead of on every render.
   - Round preset windows (24h / 7 days / 30 days) to a stable boundary so the key stops changing on its own.
   - Remove the "now + 60 seconds" upper bound in favour of a stable end boundary.

2. Make refreshing explicit and predictable
   - Keep the data briefly cached so navigating filters is instant.
   - Add a manual Refresh control so admins can pull the latest state deliberately.

3. Surface failures instead of hiding them
   - Show an error message with the reason if the fetch fails (permission, backend error), rather than an indefinite "Loading…".
   - Keep the empty state distinct from the error state.

4. Verify
   - Load /admin/email-health as an admin and confirm the stat cards and log render, counts match the deduplicated send log, and switching range/type/status refetches once each.

## Technical notes

- Changes are confined to `src/routes/_authenticated/admin.email-health.tsx`; the server function's deduplication logic is unchanged.
