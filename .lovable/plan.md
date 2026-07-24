Issue: the founding-coach window (open through 2026-09-01) currently stamps every new coach as `founding_coach=true`, and `maxPrimarySportsForCoach()` returns unlimited for any founding coach. That means a coach selecting the basic "Coach" plan today can still pick multiple sports, which breaks the intended Coach vs Coach Pro distinction.

Root cause: `src/lib/paywall-flag.ts` treats `foundingCoach` as an unlimited-sports override. The database row for `mariah+paywalltest@gradussports.com` shows `founding_coach=true` with no prior saved sports, so the onboarding UI allowed multi-select.

Plan

1. Change the sport cap rule to be data-driven.
   - In `src/lib/paywall-flag.ts`, update `maxPrimarySportsForCoach()` so it accepts the coach's current distinct primary-sport count (excluding Strength & Conditioning).
   - Rule: Coach Pro / Club = unlimited. Founding Coach on basic Coach with >1 saved primary sport already = unlimited (grandfathered). All other basic Coach users (including new founding coaches) = 1 sport.

2. Add the computed count to the coach profile DTO.
   - In `src/lib/coach-profile.functions.ts`, add `distinctPrimarySportCount` to `CoachProfileDTO`.
   - Compute it from `coach_levels` when building the profile (count distinct non-strength-conditioning sports).

3. Update all callers.
   - `src/routes/_authenticated/coach.onboarding.tsx` passes the new count from the loaded profile.
   - `src/routes/_authenticated/coach.settings.tsx` passes the new count from the saved levels.

4. Verify.
   - Run a typecheck and check that the paywall/onboarding/settings flows still compile.
   - Confirm the new test account will see a 1-sport cap while existing multi-sport founding coaches (e.g., Lauren BOBO) keep unlimited.

No database migration is needed because the cap is derived from existing `coach_levels` rows at runtime.