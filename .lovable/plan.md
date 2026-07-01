## Problem

You're signed in as a **parent**, but visited `/coach/plans/<id>` (a coach-only route). The plan loader calls a server function guarded with "This account is registered as a parent, not a coach." That error bubbles up to the `GlobalErrorBoundary`, which shows the generic "Sorry — we hit an error" screen.

## Fix

Redirect users to their own home when they hit a route for the wrong role, instead of crashing into the error boundary.

### Changes

1. **Add a small role-detection helper** — a `getMyRole()` server function that returns `"coach" | "parent" | "athlete" | null` based on which profile row exists for the current user (this logic already exists inside the guards; extract/reuse it).

2. **Add role gates to the three role subtrees** via `beforeLoad`:
   - `src/routes/_authenticated/coach.tsx` (new pathless-ish parent, or extend existing `coach.plans.tsx` layout — needs check)
   - `src/routes/_authenticated/parent.tsx` (already exists) — verify it has the gate
   - Add an equivalent for `athlete.*` and `coach.*`

   Each gate: if the caller's role ≠ the subtree's role, `throw redirect({ to: '/' })`. The index route already routes users to their correct home based on role.

3. **Recognize the wrong-role error in `GlobalErrorBoundary`** as a defensive backstop — if a server fn still throws "registered as a <role>, not a <role>", redirect to `/` instead of showing the error page.

### Result

A parent clicking a coach URL (shared link, stale bookmark, back button after switching accounts) lands on `/parent` silently instead of seeing "Sorry — we hit an error."

### Out of scope

No copy changes to the error boundary itself; no toast; no "wrong account" explainer page (per your choice).
