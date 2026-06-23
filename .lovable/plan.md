# Why Lily saw a blank screen (in plain English)

A React component is like a recipe. Every time the page redraws, React reads the recipe top-to-bottom and expects **the same ingredients in the same order, every single time**. The "ingredients" are React hooks (`useState`, `useEffect`, `useQuery`).

Lily's onboarding page broke this rule:

1. **First render** — she just signed up, her profile data was still loading. React read 3 hooks, then hit a line saying "no data yet, stop here." React memorized: *this recipe has 3 ingredients*.
2. **Second render** — data arrived a moment later. React read past the "stop here" line and found **more** hooks below it. React panicked: *you promised 3 ingredients, now there are 8 — I can't trust this recipe*.
3. React threw the component away rather than risk a broken render. No error popup, no retry — just a white screen.

Existing coaches never hit this because their data was already cached, so the "stop here" line never fired. Lily was the first brand-new Google signup to load the page with an empty cache, so she tripped the bug instantly.

The fix already shipped: the page was split into an outer shell (handles loading) and an inner form (only mounts once data exists). Now the hook count never changes mid-render.

# What we need to check next

Any page a brand-new user lands on **before data is cached** could have the same bug. I already scanned the signup and authenticated routes — most are safe (early returns happen before any hooks, or after all hooks). Two areas still deserve a careful look and a real-world test.

## Audit (read-only review)

Walk through each file and confirm: are all hooks declared *before* any `if (...) return ...`? Files to review:

- `src/routes/_authenticated/coach.roster.tsx` — has an early `return null` mid-component
- `src/routes/_authenticated/coach.plans.tsx` — two early returns inside subcomponents
- `src/routes/_authenticated/coach.plans.$planId.tsx` — early return for `planId === "new"`
- Any other `_authenticated/*` route that calls `useQuery` and renders conditionally on the result
- `src/routes/signup.*.tsx` — confirm hook order is clean for first-time visitors

For each one, the question is the same: *if a brand-new user with an empty cache landed here, would the hook count change between the first and second render?*

## Live test (end-to-end)

The audit catches the obvious cases, but the only way to be sure is to walk the new-user path with a fresh account:

1. **Coach signup via Google** — repeat Lily's exact path with a test Gmail. Confirm onboarding renders, complete it, land on the coach home.
2. **Coach signup via email/password** — same flow, different auth method.
3. **Parent signup via Google + invite code** — first parent landing on `/parent`.
4. **Athlete signup via invite code** — first athlete landing on their home.
5. **Admin signup** — fresh admin email through `/signup/admin`.

For each: watch the browser console for *"Rendered more hooks than during the previous render"* — that's the exact error signature. If it appears, the route has the same bug.

## Optional safety net

Add a top-level error boundary at `__root.tsx` that catches render crashes and shows a "Something went wrong, reload" screen instead of going blank. This won't fix the underlying bug, but it converts silent blank screens into a visible error the user can recover from and we can spot in logs.

# Technical detail

The bug is a **Rules of Hooks violation** — React requires hooks to be called in the same order on every render. An early `return` before some hooks causes the hook count to differ between renders, which throws "Rendered more hooks than during the previous render" and unmounts the component. The standard fix is to either (a) move all hooks above any early return, or (b) split into parent/child components where the parent handles the conditional and the child owns the hooks. We used (b) for `coach.onboarding.tsx`.
