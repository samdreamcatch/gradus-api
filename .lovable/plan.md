## Goal
Collect first + last name only on onboarding step 1. Remove the redundant single "Name" field from the coach signup screen.

## Changes

### 1. `src/routes/signup.coach.tsx`
- Remove the `name` state, the Name `<Label>`/`<Input>` block, and stop passing `data: { full_name: name }` in `supabase.auth.signUp(...)`.
- Keep email + password (and Google OAuth) as the only signup inputs.

### 2. `src/routes/_authenticated/coach/onboarding.tsx`
- No structural change — step 1 already captures `firstName` / `lastName` and saves via `saveCoachProfile`. It will continue to be the source of truth.
- `firstName` / `lastName` initialize from `data.profile.firstName/lastName` (empty strings for new accounts), so removing the signup Name field doesn't break pre-fill.

## Out of scope
- No DB / server function changes. `coach_profiles.first_name` / `last_name` continue to be written from onboarding step 1.
- Parent and athlete signup flows are untouched.
