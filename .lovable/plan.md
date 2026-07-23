The onboarding route (`/coach/onboarding`) is showing the global error boundary immediately after a new coach signs up. I confirmed the user was created with a valid profile (`founding_coach: true`, `entitlement: pending`). The likely cause is a conflict between the `CoachLayout` using `useSuspenseQuery` for the coach profile while the onboarding route file uses `useQuery` for the same query, and the layout loader returns early for onboarding/paywall without priming the cache. When the onboarding page redirects to `/coach/paywall`, the unmount/remount cycle can throw an uncaught error to the root boundary.

### Plan

1. **Capture the exact error**
   - Add a route-level `errorComponent` to `/_authenticated/coach.onboarding.tsx` that logs the error message and stack to the console and renders a friendlier retry UI, so the next reproduction gives us the real error instead of the generic global fallback.

2. **Make `CoachLayout` safe for onboarding/paywall**
   - Replace `useSuspenseQuery` in `PaymentIssueBanner` with `useQuery` (or `useSuspenseQuery` wrapped in a local error boundary) so the layout does not throw to the root boundary if the profile query fails or is still loading during the onboarding redirect.
   - Keep the banner read-only; it only needs to show the past-due payment banner.

3. **Prime the coach profile in the layout loader for onboarding/paywall**
   - Update `coach.tsx` `beforeLoad` so it always calls `ensureQueryData(coachProfileQueryOptions)` before rendering, even when the path is `/coach/onboarding` or `/coach/paywall`. This removes the race where the layout queries and the onboarding page query run in parallel with different suspense semantics.

4. **Simplify the onboarding landing experience**
   - In `coach.onboarding.tsx`, make the redirect-to-paywall logic wait until the profile query has settled, and only redirect if the user is still on the onboarding route. Ensure the redirect uses `replace: true` so the back button stays usable.
   - If the coach is a founding coach with `entitlement: pending`, let them stay on onboarding and finish the profile; the paywall step should be presented as the final step rather than an immediate navigation, so the user sees the form first.

5. **Verify the fix**
   - Create a fresh test coach account via the signup flow (or use the dev account switcher to simulate a newly-created coach with `entitlement: pending` and `onboarded_at: null`).
   - Confirm the onboarding form renders without the global error boundary.
   - Confirm the paywall step appears at the end of onboarding and the user can complete onboarding and land on `/coach/roster`.

### Technical details
- Files to edit: `src/routes/_authenticated/coach.tsx`, `src/routes/_authenticated/coach.onboarding.tsx`.
- No database changes needed unless the reproduced error points to a missing column or DTO field (e.g., `onboardingStep` is referenced in the onboarding page but not present in the DTO; I will verify and add a local default if needed).
- Keep the existing design system and styling; only change the data loading and redirect logic.