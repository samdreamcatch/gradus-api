## Root cause
`handleSignOut` on `/coach/paywall` (and `/admin`) navigates to `/auth`, but there's no `/auth` route in this app — the sign-in page lives at `/login`. TanStack Router matches nothing, renders the root `notFoundComponent`, and along the way the global error boundary catches an undefined error, which is why you saw the "Something broke" screen briefly followed by the 404 "Go home".

## Fix
1. **`src/routes/_authenticated/coach.paywall.tsx`** — change `navigate({ to: "/auth", replace: true })` in `handleSignOut` to `navigate({ to: "/login", replace: true })`.
2. **`src/routes/_authenticated/admin.index.tsx`** — same swap so the admin sign-out doesn't 404 either.
3. **`src/components/global-error-boundary.tsx`** — make `getDerivedStateFromError` defensive: `return { hasError: true, message: error?.message ?? "Unknown error" }` so a nullish throw never itself crashes the boundary.

## Not doing
- No new `/auth` route (redundant with `/login`).
- No changes to the sign-out logic itself (query cancel/clear + `supabase.auth.signOut()` are correct).
