# Fix: switching accounts shows the previous user's app

## What's happening

Your account data is correct — `parent@test.dev` has only a parent profile and no coach profile, so the server would answer "parent" if asked. The problem is client-side caching.

When you switch accounts from the dev panel, the app signs the new user in but keeps the cached answer to "what role am I?" from the previous session. That cached answer is not tied to a user, so the parent session reads the coach's answer, the parent route guard decides "this person is a coach", and it bounces you into the coach app — where every other cached coach screen is also still sitting in memory.

Signing in is currently handled by refreshing caches in the background rather than clearing them, and navigation happens before that refresh finishes, so the stale answer wins the race.

## The fix

1. On a genuine account switch (the signed-in user ID changes), wipe the cached data outright instead of refreshing it in the background. Keep the current gentler refresh behavior when the same user's session simply renews — that's what protects the signup/paywall flow we fixed earlier.
2. Tie the role lookup cache to the signed-in user, so one user's role can never be served to another even if a clear is missed.
3. In the dev account switcher, wait for the cache reset and router refresh to complete before navigating to the new account's home screen.

## Technical details

- `src/routes/__root.tsx` (`AuthSync`): track the previous `session.user.id` in a ref. On `SIGNED_IN`/`USER_UPDATED`, if the user ID differs from the previous one (or there was none), call `queryClient.clear()`; otherwise keep `invalidateQueries()`. Then `router.invalidate()` as today.
- `src/lib/role-guard.ts`: make `myRoleQueryOptions` a function of the user ID (`["my-role", userId]`), or have `requireRole` remove the `["my-role"]` entry when the cached value was fetched for a different user. Update the call sites in `_authenticated/coach.tsx`, `_authenticated/parent.tsx`, and any other `requireRole` users.
- `src/components/dev/dev-tools.tsx` (`signInAs`): after `signInWithPassword` succeeds, `queryClient.clear()` and `await router.invalidate()` before `navigate({ to: acct.home })`, so the guard re-runs against the new session.

No database or server-function changes are needed.
