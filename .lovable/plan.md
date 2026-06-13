## Why the name is asked twice

1. `/signup/coach` collects `firstName` / `lastName` and passes them as Supabase auth `user_metadata` (`first_name`, `last_name`, `full_name`) on `supabase.auth.signUp`. They are **not** written to `coach_profiles`.
2. `coach.onboarding.tsx` Step 1 ("What's your name?") then asks again, and that's where the names actually land in `coach_profiles` via `saveCoachProfile`.

So the signup name is captured but never persisted, and onboarding re-collects it.

## Fix

Persist the signup name into `coach_profiles` on first load, and drop the redundant step.

1. **`src/lib/coach-profile.functions.ts` — `ensureProfile`**
   On the INSERT path (first time the coach loads anything), read `auth.users.raw_user_meta_data` for `first_name` / `last_name` (fallback: split `full_name` on the first space; Google OAuth only provides `full_name`). Insert those values alongside `user_id` so `coach_profiles.first_name` / `last_name` are populated immediately after signup. Existing rows are untouched.

2. **`src/routes/_authenticated/coach.onboarding.tsx`**
   - Remove Step 1 (the name inputs) and the `saveProfile` mutation call from `handleContinue`.
   - Renumber: steps become 1 Sports → 2 Levels → 3 Practice hours → 4 Invite parents → 5 Review. Update the "Step X of 5" header, the 5 progress pips, the `canContinue` switch, and the `handleContinue` / `handleFinish` gating (`step < 5` instead of `< 6`).
   - Keep `firstName` / `lastName` state (sourced from `data.profile`) so `ReviewSummary` still shows the coach's name.
   - **Safety net:** if `data.profile.firstName` is empty (edge case — older accounts, or a Google user whose metadata split failed), fall back to showing the name step as step 1 so the coach can't end up with a blank profile. Implemented as a computed `needsName` flag that conditionally prepends the name step.

3. No changes to `/signup/coach` — it already collects and forwards the name.

## Technical notes

- `ensureProfile` already uses the authenticated `supabase` client; reading `auth.users` from it requires `supabase.auth.getUser()` (which returns metadata) rather than a direct table query — RLS blocks reads on `auth.users`. Use `context.claims` if it already carries `user_metadata`; otherwise call `supabase.auth.getUser()` inside `ensureProfile`.
- No DB migration needed; the columns already exist and are nullable/empty-string defaulted.
- No change to `saveCoachProfile` — it stays available for the future "edit profile" screen and the `needsName` fallback path.
