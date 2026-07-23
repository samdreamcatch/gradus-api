# Plan: Fix blank paywall after signup

## What I know

- The blank paywall resolves on refresh, which means the component/UI can render correctly; the problem is the **transition from signup to the first authenticated route**.
- The `_authenticated` layout uses `supabase.auth.getUser()` (server re-validation) in `beforeLoad`. After signup, the `AuthSync` effect in `__root.tsx` clears the entire query cache and calls `router.invalidate()` on `SIGNED_IN`.
- This combination creates a race: the auth gate can briefly see no authenticated user, redirect to `/login`, and the login page redirects back to `/coach/paywall` — all while the router is transitioning, which can leave the user looking at a blank screen.
- `coach.paywall.tsx` does not have a `pendingComponent` or `beforeLoad` that handles this transition.

## What I will do

1. **Stabilize the auth state after signup**
   - In `src/routes/signup.coach.tsx`, after `supabase.auth.signUp()` succeeds, wait for `supabase.auth.getUser()` to confirm the session is validated before navigating to `/coach/paywall`.
   - For the OAuth path, ensure the post-callback effect also waits for a validated session before redirecting.

2. **Reduce the `AuthSync` disruption on `SIGNED_IN`**
   - In `src/routes/__root.tsx`, stop clearing the entire query cache on `SIGNED_IN`. Use `queryClient.invalidateQueries()` instead, or only invalidate the queries that depend on auth identity.
   - Keep the cache clear for `SIGNED_OUT` in the sign-out handler, but remove the `SIGNED_IN` cache clear from the global `AuthSync` listener.

3. **Harden the paywall route against auth transitions**
   - Add a `beforeLoad` to `src/routes/_authenticated/coach.paywall.tsx` that fetches the coach profile via `ensureQueryData` and waits for auth to be stable before rendering.
   - Add a `pendingComponent` to the paywall route that shows a themed loading state (not a blank page) while the auth gate and profile load.

4. **Add defensive logging**
   - Add temporary, clearly labeled `console.log` statements in `signup.coach.tsx`, `_authenticated.tsx`, and `coach.paywall.tsx` so the exact sequence can be verified in the browser after the fix.

5. **Verify end-to-end**
   - Run a new coach signup flow in the local dev server using the dev account switcher and a fresh test account to confirm the paywall renders on the first navigation without requiring a refresh.
   - Confirm that existing coaches can still reach `/coach/paywall` from Settings and that the route still respects the current plan.

## Out of scope

- No changes to Stripe pricing, promo codes, or subscription logic.
- No redesign of the paywall UI beyond the loading/fallback state.

## Questions

Do you want me to proceed with this plan, or do you want to pair down the scope (e.g. only fix `AuthSync` first, or only add the signup wait)?