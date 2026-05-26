## Goal

Make role boundaries unambiguous in the route tree so a parent can never accidentally land in the coach wizard, and so parents who abandon signup get resumed where they left off.

## Part 1 — Rename `/onboarding` → `/coach/onboarding`

The wizard at `/onboarding` is 100% coach-specific (writes to `coach_profiles` + `coach_levels`, requires auth, generates a coach invite code). The generic name is what lets parents end up there via stale `redirect=` params or fallback paths.

**Move the file:**
- `src/routes/_authenticated/onboarding.tsx` → `src/routes/_authenticated/coach.onboarding.tsx`
- Update `createFileRoute("/_authenticated/onboarding")` → `createFileRoute("/_authenticated/coach/onboarding")`

**Drop the parent-bounce `beforeLoad` guard** we added yesterday — it becomes unnecessary because the URL is now explicitly under `/coach/*`. (We keep the `ensureProfile` parent-blocking guard in `coach-profile.functions.ts` as defense-in-depth.)

**Update redirects pointing at the old path:**
- `src/routes/_authenticated/coach.tsx` — `navigate({ to: "/onboarding" })` → `navigate({ to: "/coach/onboarding" })` in the "not onboarded" gate.
- Grep for any other `"/onboarding"` strings (login fallbacks, OAuth `redirect_uri`, etc.) and repoint them.

**Layout interaction:** the existing `coach.tsx` file is a leaf route at `/coach`, not a layout. Adding `coach.onboarding.tsx` as a sibling is fine — TanStack treats them as two separate leaves under the `/coach` URL prefix; no `<Outlet />` plumbing needed.

## Part 2 — Add a resume-signup gate on `/parent`

Mirror the coach pattern: when a parent hits `/parent`, check whether they've completed signup, and if not, bounce them back into the signup wizard at the right step.

**Definition of "completed":** has at least one row in `athletes` linked to their `parent_profiles.id`. (Goals and schedule are nice-to-have but the athlete row is the minimum that makes the parent home page meaningful.)

**Implementation:**
- In `src/routes/_authenticated/parent.tsx`, change the loader/`beforeLoad` to call a small server fn (`getParentSignupStatus` in `parent-signup.functions.ts`) returning `{ hasAthletes: boolean, inviteCode: string | null }`.
- If `!hasAthletes`, `throw redirect({ to: "/signup/parent/athletes", search: { code: inviteCode } })`.
- The invite code comes from `parent_profiles.coach_invite_code` (or whatever column we stored it on during `startParentSignup`) so the wizard can resume without re-asking.

## Part 3 — Verification

After the changes:
1. Sign in as Lorelai → should land on `/signup/parent/athletes` with her coach's code pre-filled, not on an empty `/parent`.
2. Sign in as a parent who completed signup (e.g. June Cleaver) → should land on `/parent` normally.
3. Sign in as an un-onboarded coach → should land on `/coach/onboarding` (new URL).
4. Manually visit `/onboarding` while signed in as a parent → 404 (the route no longer exists), which is the correct outcome.

## Out of scope

- Renaming `/signup/coach` or restructuring the parent signup sub-routes.
- Adding a goals/schedule completion check to the parent gate (only athlete presence is gated; the rest stay optional for now).
- Any visual/UX changes to the wizards themselves.
