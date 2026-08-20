# Plan: track down the plan-viewing error for Addie / Christine

## What I verified

- The error is **not** in the error table. The newest row in `client_errors` is from Aug 19 (`/athlete/settings`), nothing from today. So the failure happened somewhere our reporter doesn't capture — most likely a server-function failure surfaced by a route error boundary rather than an uncaught window error.
- The 2026-08-10 fix for the old "empty coach id" bug is still in place: both `getAthletePlan` and `getParentPlan` now skip the coach lookup when a plan has no coach, so that specific cause is already handled.
- I could not find a remaining query that sends an empty string into a UUID column by reading the code, and an empty `in.()` filter is accepted by the database (I tested it), so that's not it either. **The root cause is currently unconfirmed** — I won't guess at a fix.
- One real data problem did turn up: **Addie DiMuro exists twice.**
  - `3e60f91b…` — birthdate 2007-10-08, username `addie`, linked to Christine, has both plans (a Gradus "Juvenile — Free Skate" plan and a coach plan "July 20-24").
  - `066e1147…` — same name and birthdate, self-managed, no parent, no plans, a *different* login.
  If Addie signed in on the second account, or if the connect flow crossed the two, the plans page is operating on an athlete record that doesn't own those plans.

## Steps

1. **Close the reporting gap first.** Make failures on the plans routes actually land in the admin error table:
   - Report errors caught by the route `errorComponent`s on the athlete and parent plan list/detail routes (currently they render a message and nothing is logged).
   - Log server-function failures in `getAthletePlan`, `getParentPlan`, `listAthletePlans`, `listParentPlans` server-side (full message + user id) before `dbError` collapses them into "Something went wrong".
2. **Reproduce.** With logging in place, sign in against both Addie accounts and Christine's parent account and open each of the two plans, capturing the real error text and stack.
3. **Fix the confirmed cause.** Once the actual error is in hand, fix it at the source rather than patching the symptom, and check the sibling code path (athlete vs parent) for the same mistake.
4. **Resolve the duplicate athlete.** Decide which Addie record is canonical, and either merge/retire the stray self-managed row or block the duplicate from being reachable, so plans, sessions and the coach link all hang off one athlete.

## Technical notes

- Reporting path is `src/lib/client-error-reporter.ts` → `logError` in `src/lib/error-tracking.server.ts`; route boundaries currently bypass it.
- `dbError` in `src/lib/db-error.ts` already logs full detail to server logs, but those aren't visible in the admin panel — the additional call sends the same detail into `client_errors`.
- Files in play: `src/lib/athlete-plans.functions.ts`, `src/lib/parent-plans.functions.ts`, `src/routes/_authenticated/athlete.plans.index.tsx`, `athlete.plans.$planId.tsx`, `parent.plans.index.tsx`, `parent.plans.$planId.tsx`.
