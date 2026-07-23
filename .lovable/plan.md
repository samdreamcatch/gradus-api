The onboarding crash immediately after signup appears to be caused by the role gate in `src/lib/role-guard.ts`. For a brand-new coach, the `coach_profiles` row is created lazily by the first `getCoachProfile` call, so `getMyRole()` can return `{ role: null }`. The server-fn wire format may serialize that null as an empty string. `requireRole` currently treats `!role` as "no role yet", but it does **not** treat an empty string the same way, so it falls through to `throw redirect({ to: ROLE_HOME[role] })` where `role` is `""` and `ROLE_HOME[""]` is `undefined`. That redirect-to-undefined is the `undefined` error repeatedly hitting the global error boundary during onboarding.

Plan

1. Harden `src/lib/role-guard.ts`
   - Normalize `data.role` so that `null` and `""` are both treated as "no role determined yet".
   - Guard against an unknown role value by only redirecting when `ROLE_HOME[role]` is a real string.
   - Keep the existing behavior where a missing role allows the flow to continue to the downstream profile creation (i.e., `coach.tsx` `beforeLoad` → `ensureQueryData(coachProfileQueryOptions)` → `ensureProfile` creates the row).

2. Verify with the existing Playwright reproduction
   - Re-run the new-coach signup → onboarding path and confirm no "Something broke" / `undefined` error boundary hit.
   - Confirm the URL ends on `/coach/paywall` for an un-onboarded new coach as expected.
   - Check that existing coaches, parents, and athletes still pass their role gates unchanged.

No new pages or components are needed. This is a targeted guard fix in the role-guard utility.