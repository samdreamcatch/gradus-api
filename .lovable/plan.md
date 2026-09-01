# Extend the Founding Coach window to November 1, 2026

Today, any coach who finishes onboarding before **September 1, 2026** is automatically stamped as a Founding Coach (lifetime-free access). This moves that deadline out to **November 1, 2026**, so coaches joining in September and October also get Founding Coach status.

## What changes

- New coaches onboarding any time before Nov 1, 2026 (UTC) are stamped Founding Coach with complimentary access.
- Existing coaches keep everything they have — Founding Coach status is stored on their profile, so nothing is revoked or re-evaluated.
- Free access for all onboarded coaches (the paywall bypass tied to this same window) also continues through Nov 1, 2026.

## Technical detail

- `src/lib/paywall-flag.ts`: change `FOUNDING_COACH_CUTOFF` from `2026-09-01T00:00:00Z` to `2026-11-01T00:00:00Z`. This one constant feeds `isFoundingCoachWindowOpen()`, which is the only gate used by the onboarding stamp, the lazy backfill in `coach-profile.functions.ts`, and the paywall bypass in `src/routes/_authenticated/coach.tsx`.
- Update the stale "Sept 1, 2026" comment in `src/routes/_authenticated/coach.tsx` to match.
- No database migration and no UI copy changes — the historical backfill migration stays as-is, and no user-facing string names the date.
- Verify with Prettier, `bunx tsgo --noEmit`, and lint.
