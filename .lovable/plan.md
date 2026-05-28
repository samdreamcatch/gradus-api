## Root cause
`/_authenticated` calls `supabase.auth.getUser()` in `beforeLoad`, and `/login`'s `beforeLoad` calls `getSession()`. During initial hydration these can disagree for a tick: `getUser()` returns no user → redirect to `/login` → `getSession()` then sees the restored session → redirect back to `/parent`. That bounce is the flashing.

The fix is to give the guard a third state: `loading`. While the session is still hydrating, render nothing (or a spinner) and do not redirect.

## Plan
1. Add a shared `useAuthReady` hook (`src/hooks/use-auth-ready.ts`)
   - Calls `supabase.auth.getSession()` once on mount; flips `isReady` to true when it resolves.
   - Subscribes to `onAuthStateChange` to keep `user` fresh.
   - Returns `{ user, isReady }`.

2. Convert `/_authenticated` from a `beforeLoad` redirect into a client-side guard component
   - Remove the `getUser()` call in `beforeLoad`.
   - In the component: use `useAuthReady`.
     - `!isReady` → render a minimal loading state (null / spinner), no navigation.
     - `isReady && !user` → `<Navigate to="/login" search={{ redirect: location.href }} />`.
     - `isReady && user` → `<Outlet />`.
   - This eliminates the SSR/hydration race that fires the first wrong redirect.

3. Make `/login` consistent with the same readiness model
   - Drop the `beforeLoad` `getSession()` auto-redirect.
   - In the component: if `isReady && user`, redirect to `search.redirect` (or role-based default). Otherwise render the form.
   - Prevents the back-bounce when the session resolves a moment after `_authenticated` already kicked us here.

4. Keep `/parent` onboarding-resume logic, but only after auth is ready
   - The existing `beforeLoad` in `_authenticated/parent.tsx` calls `getParentSignupStatus()`, which requires a bearer token. With the guard above, by the time this runs `useAuthReady` has confirmed a session and `attachSupabaseAuth` will attach the token. No structural change needed beyond confirming order.

5. Verify
   - Sign in as Lorelai → no flicker, lands on `/parent` (or onboarding step) once.
   - Sign out → lands on `/login` once.
   - Direct visit to `/parent` while signed out → brief loading, then `/login?redirect=/parent`.

## Technical details
Files to change:
- new: `src/hooks/use-auth-ready.ts`
- `src/routes/_authenticated.tsx` — replace `beforeLoad` redirect with component-level loading/redirect using `useAuthReady`.
- `src/routes/login.tsx` — remove `beforeLoad` session check; use `useAuthReady` in the component to redirect already-signed-in users after hydration.
- `src/routes/_authenticated/parent.tsx` — no logic change; just confirm its `beforeLoad` only runs after the parent guard renders `<Outlet />`.

Out of scope:
- No changes to server functions, `start.ts`, or `AuthSync` in `__root.tsx`.
- No DB changes.