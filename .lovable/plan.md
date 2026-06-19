## Symptom
On the published site, finishing onboarding (coach or parent) frequently lands on a blank screen instead of `/coach/roster` or `/parent` home.

## Likely root causes

Both landing routes (`/coach` and `/parent`) are pure "navigator" components that read a React Query cache and `useEffect` redirect — but they render `return null` (coach) or a near-empty shell (parent) while the query is undefined. After the final onboarding mutation, two things can leave them stuck:

1. **Coach (`src/routes/_authenticated/coach.index.tsx`) — stale-cache redirect loop.**
   `handleFinish` in `coach.onboarding.tsx` does `await complete.mutateAsync()` then `navigate({ to: "/coach" })`. The mutation's `onSuccess` only *schedules* an invalidation; the next render of `CoachHome` reads the still-stale `coach-profile` (where `onboardedAt` is null) and pushes back to `/coach/onboarding`. Onboarding's own guard then sees the fresh data and bounces to `/coach`. During the in-flight refetch both pages render `null` → blank. If anything throws mid-cycle (e.g. the optional `claimParentInvite` after `complete`), navigation never fires at all and we stay on the null `CoachHome`.

2. **Parent (`src/routes/_authenticated/parent.index.tsx`) — pending status query + empty body.**
   `ParentHome` waits on `getParentSignupStatus`; until it resolves the page renders only `<ParentBottomNav />` inside a max-w-2xl container — visually blank above the nav. If the user already has a coach, `showInviteCard` is false and the page *stays* mostly empty by design. After signup it also relies on a stale cache to decide whether to push to `/signup/parent/athletes`.

3. **No `errorComponent` / no visible loading state** on either index, so any thrown server-fn error (e.g. a transient 401 on first post-onboarding call before the session cookie is fully written) shows as a blank page rather than an error/loading UI.

## Plan

### Step 1 — Add diagnostics first (one deploy)
Before changing flow, add lightweight logging so we can confirm which branch the user hits on production:
- `console.info` in `CoachHome` and `ParentHome` on each render with `{ hasData, onboardedAt, pathname }`.
- `console.error` wrappers around `complete.mutateAsync`, `claim`, and `saveAthleteSchedule` call sites.
- Add `errorComponent` and a real loading state (spinner + "Loading…") to:
  - `_authenticated/coach.index.tsx`
  - `_authenticated/coach.onboarding.tsx`
  - `_authenticated/parent.index.tsx`
  - `_authenticated/parent.tsx`

This alone removes the "blank screen" UX — worst case the user sees a spinner instead of nothing.

### Step 2 — Fix the coach redirect loop
In `coach.onboarding.tsx#handleFinish`:
- After `complete.mutateAsync()`, explicitly refetch before navigating:
  `await qc.invalidateQueries({ queryKey: ["coach-profile"] })` then
  `await qc.refetchQueries({ queryKey: ["coach-profile"] })`.
- Wrap the post-complete `claimParentInvite` block so a thrown error does NOT skip the final `navigate({ to: "/coach" })` (currently it's inside the same try; if `complete` throws we toast and stay, which is correct, but the invite-claim block should be its own try/catch — it already is, but verify the `finally` always runs `navigate`).
- Alternative (preferred): navigate straight to `/coach/roster` instead of `/coach`, eliminating the double-hop through `CoachHome`.

In `coach.index.tsx`:
- Replace `useEffect`-redirect-on-cache pattern with a loader that calls `ensureQueryData(coachProfileQueryOptions)` and a `throw redirect(...)` decision, so the redirect happens *before* render and is based on fresh data. Same change for `parent.index.tsx`.
- Show a spinner (not `return null`) while `data` is undefined.

### Step 3 — Fix the parent landing
- Same loader-based redirect in `parent.index.tsx`: if no profile → `/signup/parent`; if profile but no athletes → `/signup/parent/athletes`; otherwise render the home content.
- Give the post-redirect home a real "welcome" body so it's never visually blank, even when `showInviteCard` is false.

### Step 4 — Verify
- Ship Step 1, then ask the user to reproduce and share console logs (auto-captured) and the URL where they're stuck.
- Apply Steps 2–3 based on which branch the logs implicate.

## Technical notes
- `_authenticated` already sets `ssr: false`, so loaders here run client-side with the session present — using a loader + `throw redirect` is safe and avoids the "render null then useEffect navigate" race.
- `useCompleteOnboarding` already invalidates on success; the fix is to `await` the refetch in the caller before navigating, not in the hook (other callers may not want to block).
- No backend or schema changes.

## Files touched
- `src/routes/_authenticated/coach.index.tsx`
- `src/routes/_authenticated/coach.onboarding.tsx`
- `src/routes/_authenticated/parent.index.tsx`
- `src/routes/_authenticated/parent.tsx`
- (optionally) `src/hooks/use-coach-profile.ts` — expose an `awaitInvalidate` helper if reused elsewhere.
