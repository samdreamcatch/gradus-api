In `src/routes/_authenticated.tsx`, hide `<FeedbackFab />` on onboarding routes in addition to admin routes.

Change line 94 gate from:
```tsx
{isAdmin ? null : <FeedbackFab />}
```
to hide when `isAdmin` OR the path ends in `/onboarding` (covers `/athlete/onboarding` and `/coach/onboarding`). Add `const isOnboarding = pathname.endsWith("/onboarding");` alongside the existing pathname checks.

Parent onboarding (`/signup/parent/*`) is unauthenticated and never mounts this layout, so no change needed there.

Out of scope: signup entry pages, other FABs, or changes to the feedback component itself.
