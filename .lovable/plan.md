# Grandfather founding coaches into multi-sport selection

## Problem
The upcoming Coach / Coach Pro distinction caps basic coaches at **one primary sport** (plus Strength & Conditioning). Right now, founding coaches on the basic `Coach` tier compute `effectiveTier === "coach"`, so the UI would lock Lauren BOBO — a real founding coach with 3 sports — out of two of her existing sports the moment the update ships.

## Current behavior
The cap is applied only in the client UI, in two places:
- `src/routes/_authenticated/coach.onboarding.tsx` (line 113): `const primarySportCap = effectiveTier === "coach" ? 1 : undefined;`
- `src/routes/_authenticated/coach.settings.tsx` (line 219): `const maxPrimarySports = effectiveTier === "coach" ? 1 : undefined;`

The server function `saveCoachLevels` does not enforce a sport cap; it replaces all rows with whatever the UI sends. So the gating is purely UI-side.

## Plan

1. **Centralize the multi-sport cap rule** in a small helper in `src/lib/paywall-flag.ts`:
   ```ts
   export function maxPrimarySportsForCoach(profile: {
     effectiveTier: CoachEffectiveTier;
     foundingCoach: boolean;
   }): number | undefined {
     if (profile.foundingCoach) return undefined;
     return profile.effectiveTier === "coach" ? 1 : undefined;
   }
   ```
   - Founding coaches stay unlimited.
   - Club and Coach Pro stay unlimited.
   - New non-founding basic coaches remain capped at 1.

2. **Update both cap call sites** to use the helper and pass `foundingCoach`:
   - `src/routes/_authenticated/coach.onboarding.tsx`
   - `src/routes/_authenticated/coach.settings.tsx`

3. **Verify no other cap sites exist** by searching for `maxPrimarySports` / `primarySportCap` and confirm `saveCoachLevels` stays cap-agnostic.

4. **Validation before deployment**:
   - Confirm Lauren BOBO's `coach_profiles.founding_coach` is `true` and `coach_levels` includes dance, figure_skating, and strength_conditioning.
   - Check the settings UI renders all three sports editable and the onboarding sport picker does not lock the non-S&C sports.

## Why this is safe
- No database schema or policy changes are required.
- Existing coach_levels rows are untouched.
- The server already accepts multi-sport saves; only the UI was preventing it.
- Founding coaches remain on the `Coach` tier but are exempt from the single-sport limitation, matching the user's intent that they keep their existing capabilities.

## After this
If you want a clearer settings label for founding coaches (e.g., "Founding Coach · multi-sport included"), we can add that as a follow-up UI polish.