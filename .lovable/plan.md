# Fix the preview stuck on "Loading Gradus…"

## What I found

The branch switch is not the cause. The preview server is healthy (it serves the site, builds cleanly, and loads fine for a signed-out visitor). Your preview tab is signed in as the parent account, sitting on `/parent/plans`, and is frozen on the "Loading Gradus…" screen — with **zero** network activity. It is not retrying; it is hung waiting on one call that never comes back.

That screen is the pending state of the authenticated layout. It shows while `supabase.auth.getUser()` resolves in the route's `beforeLoad`. That call is hanging.

Why it hangs: the auth client serializes every call behind a browser-wide lock shared across tabs of the same origin. You currently have **two preview tabs open**, and several places kick off auth work the moment the app boots — the route gate, the auth-sync listener in the root, and the DEV tools panel each start their own auth call. When one of those never releases the lock (common after a full sandbox re-clone, which is exactly what a branch switch triggers), every later call queues forever and the gate never resolves. There is no timeout and no fallback, so the app waits indefinitely.

Immediate unblock (no code needed): close all but one preview tab, then hard-refresh. If it still hangs, clearing site data for the preview domain releases the stale lock.

The plan below makes that state impossible to get stuck in again.

## Changes

1. **Bound the auth gate.** In the authenticated layout gate, race the user lookup against a short timeout (about 4 seconds). On timeout, fall back to reading the already-cached session instead of hanging. If that also yields nothing, redirect to login rather than showing a spinner forever.

2. **Stop competing for the lock at boot.** The DEV tools panel makes its own session call and its own four role queries on every mount. Make it wait until the app has settled and reuse the session the root already resolved, so boot does one auth call instead of three.

3. **Give the pending screen an escape hatch.** If "Loading Gradus…" is still on screen after ~6 seconds, show a "Taking longer than expected — reload" action so a hang is always recoverable by the user instead of being a dead end.

4. **Verify.** Reproduce in a headless browser with a signed-in parent session, confirm `/parent/plans` renders, and confirm the timeout path lands on login rather than the spinner.

## Technical notes

- `src/routes/_authenticated.tsx` — `beforeLoad` currently awaits `supabase.auth.getUser()` unbounded; wrap in `Promise.race` with a timeout, fall back to `supabase.auth.getSession()` (local, lock-light), then redirect to `/login` on failure. Add the delayed reload affordance to `AuthPending`.
- `src/components/dev/dev-tools.tsx` — `detectRole` fires four parallel table reads plus `getSession()` on mount; defer behind the sheet being opened (or an idle callback) so it never participates in the boot-time lock contention.
- No database, RLS, or Stripe changes. Nothing here touches the published site.

## Not in scope

Reverting the Git branch. Staying on `main` is fine and unrelated to this hang — the only ongoing consequence is that the preview reflects whatever is on `main`.
