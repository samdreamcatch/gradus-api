Plan: Fix the recurring `/coach/onboarding` crash for new users

Context
- New coaches signing in land on `/coach/onboarding` and hit a generic error boundary.
- The previous fix stabilized `useInstallPrompt` (a `useSyncExternalStore` hook in the root layout). That fixed the root-level crash, but the same symptom is back on the onboarding route, which suggests another hook/component in the onboarding render path is throwing a non-Error value (the console logs show an `undefined` error).

Hypotheses to verify
1. `cmdk` (used by `SportMultiselect` on the onboarding page) relies on `useSyncExternalStore` with a server snapshot that may not be stable in our React 19 / TanStack Start setup, causing an infinite-loop or undefined throw.
2. `CoachLayout` renders `PaymentIssueBanner`, which uses `useSuspenseQuery` without a Suspense boundary. If the `coach-profile` query is not cached, it throws a Promise; the root `ErrorComponent` then expects an `Error` and crashes on `error.message`, which can mask the real issue and leave the user on the generic boundary.

Steps
1. Reproduce cleanly
   - Sign up / sign in as a never-onboarded coach in a fresh browser session.
   - Capture the exact console trace and network activity at the moment the error boundary appears.
   - Confirm whether the thrown value is `undefined`, a Promise, or another object, and which component is throwing it.

2. Audit `useSyncExternalStore` in the onboarding tree
   - Check `useInstallPrompt`, `useBottomBannerLock`, `cmdk` (`Command`/`CommandItem`), and any other hook in the render path that uses `useSyncExternalStore`.
   - Ensure every server snapshot is a stable, memoized value or primitive, and that every client snapshot returns a stable value.

3. Fix the most likely culprit(s)
   - If `cmdk` is unstable: wrap the `Command` usage inside `SportMultiselect` in a client-only guard or replace it with a lightweight custom popover list that does not use `useSyncExternalStore`.
   - If `PaymentIssueBanner` is throwing a Promise: change it from `useSuspenseQuery` to `useQuery` (or wrap it in a Suspense boundary with a fallback) so it never throws during the onboarding render.
   - Harden the root `ErrorComponent` so it does not crash when `error` is not an `Error` (e.g., a Promise or `undefined`). This prevents the generic boundary from masking the real error.

4. Fix the onboarding redirect race
   - Ensure the `OnboardingPage` `useEffect` redirect to `/coach/paywall` for pending users does not cause a flash of the onboarding form before navigation.
   - If needed, keep the "Finishing up…" spinner state while the redirect is in flight.

5. Verify end-to-end
   - Create a new test coach and complete the signup → onboarding → paywall → roster flow.
   - Confirm no error boundary, no blank screen, and the coach lands on `/coach/roster` after onboarding.
   - Confirm existing coaches can still sign in and use `/coach/settings`, `/coach/paywall`, etc.