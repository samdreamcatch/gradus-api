## Goal

For self-managed 18+ athletes only:
1. During post-signup onboarding, collect one sport + goals per sport (current level, season goal, long-term goal) — mirroring parent onboarding but scoped to the athlete themself.
2. Add a "Coaches" section in Athlete Settings (link/unlink coach by invite code, edit sports per coach) — mirroring the parent-settings CoachesSection.

Nothing changes for athletes with `self_managed = false` (under-18): their onboarding is still the parent flow, and `/athlete/settings` shows the same minimal screen it does today.

## User-visible changes

**Adult onboarding (`/athlete/onboarding`)**
- Step 1 (unchanged): optional coach invite code → preview → pick sports → link, or "Skip for now".
- Step 2 (new): "Your goals" — iterate over the sports the athlete just picked. If they skipped the coach step, let them pick sports from the full sport catalog first (or skip goals entirely). For each sport, ask:
  - Current level (from `SPORTS[sport].levels`)
  - Season goal (same list)
  - Long-term goal (free-form, optional)
- "Save & next sport" until done, then land on `/athlete/plans`.
- Skipping goals is allowed; athletes can fill them in later from settings (future work — out of scope for this change).

**Athlete settings (`/athlete/settings`)**
- New "Coaches" group, rendered only when the loaded profile is `self_managed`. Same layout as the parent-settings "Coaches" disclosure:
  - List currently linked coaches with their sports; per-row "Edit sports" and "Unlink".
  - "Link a coach" form: 8-char code → preview → pick sports → link.
- Existing minor-athlete settings screen is untouched (the new group is not rendered when `self_managed` is false).

## Technical details

### Server functions (`src/lib/adult-athlete-signup.functions.ts` — extend)

Add adult-scoped equivalents that resolve `athleteId` from `context.userId` and require `self_managed = true`, so nothing here can be abused against minor rows:

- `saveAdultAthleteGoals({ sport, currentLevelKey, seasonGoalKey, longTermGoal })` — upsert into `athlete_goals` for the caller's self-managed athlete. If a linked coach offers that sport, stamp `coach_id` from `athlete_primary_coaches` (upsert primary the same way `saveAthleteGoals` does).
- `listAdultAthleteCoaches()` — returns `{ coaches: [{ coachId, coachName, sports[] }], selfManaged }` for the settings UI.
- `unlinkAdultAthleteFromCoach({ coachId })` — deletes the `coach_athletes` row (trigger cascades `coach_athlete_sports`).
- `updateAdultAthleteCoachSports({ coachId, sports[] })` — replaces `coach_athlete_sports` for (self-managed athlete, coach), validating each sport is in the coach's `coach_levels`.
- `previewCoachForAdultAthlete` / `linkAdultAthleteToCoach` already exist and are reused by settings.

All new functions use the user-scoped supabase client so the existing self-managed RLS branches on `athletes`, `athlete_goals`, `coach_athletes`, `coach_athlete_sports`, and `athlete_primary_coaches` remain the authoritative gate. `supabaseAdmin` is only used for opaque lookups (invite code → coach id, coach's offered sports).

### Onboarding route (`src/routes/_authenticated/athlete.onboarding.tsx`)

Turn the current single-screen component into a two-step wizard driven by local state:

```text
step = "coach"        → existing coach-code UI, unchanged
    on link success   → step = "goals", sports = chosen sports
    on skip           → step = "goals", sports = [] (athlete picks in-place)
step = "goals"        → per-sport form (Select level, Select season goal, Textarea long-term)
                        "Save & next" / "Continue" → /athlete/plans
                        "Skip goals" ghost button also → /athlete/plans
```

Sport-picker in the skip path uses `SPORTS` from `@/lib/coach-sports` (same source parent flow uses). Reuse `SportChip`.

### Athlete settings (`src/routes/_authenticated/athlete.settings.tsx`)

- Extend `getAthleteSettings` to include `selfManaged: boolean` and `coaches: [{ coachId, coachName, sports[] }]` (or call `listAdultAthleteCoaches` from a second `useQuery` — pick whichever keeps the diff smallest; leaning toward a second query so `athlete-settings.functions.ts` stays untouched).
- New `AdultCoachesSection` component modeled on parent-settings `CoachesSection`, wired to the adult-scoped server fns above. Rendered only when `selfManaged === true`.
- No changes to `ProfileDisclosure`, appearance, sign-out, or the minor-athlete path.

### Data model

No schema changes. Existing `athlete_goals`, `coach_athletes`, `coach_athlete_sports`, `athlete_primary_coaches` policies already have `self_managed` branches (added in the prior migration). Verified during exploration that the DB trigger + CHECK constraints keep minors out of any self-managed branch.

### Not in scope

- Editing goals from settings (adult or minor).
- Adult schedule / lesson-slot editing in settings.
- Any change to parent, coach, or under-18 athlete UI/architecture.
- Aging-up minors (already deferred).
