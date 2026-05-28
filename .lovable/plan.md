# Athlete Signup Flow

Three-step wizard that turns a parent-issued 8-char invite code into a real auth account linked to the existing `athletes` row.

## User flow

1. Role picker → "I'm an athlete" (currently disabled) routes to `/signup/athlete`.
2. **Step 1 — Enter code.** Single 8-char code input (uppercase, `A-Z2-9`). Validates against `athlete_invite_codes` (must exist, not consumed, not expired). On success, advances to step 2 with the code in the URL.
3. **Step 2 — Confirm identity.** Reads-only preview: first name, last name, sport chip(s), coach name. Big "This is me / Not me" CTA. (The athlete's name and parent-set data are already in the DB — they just confirm.)
4. **Step 3 — Create account.** Email + password fields. On submit: create Supabase auth user, claim the invite code, attach `auth.uid()` to the `athletes.user_id` column, mark code consumed. Sign the user in and redirect to `/athlete`.
5. **/athlete placeholder** — minimal "Welcome, {firstName}" page styled with the design system.

## Screens (all reuse design system components)

- `src/routes/signup.athlete.tsx` — Step 1 (replaces current stub). Single code input, `Logo`, paper card, primary `Button`.
- `src/routes/signup.athlete.confirm.tsx` — Step 2. Reads `?code=`, calls `getAthleteInviteSummary`, shows `SportChip` for the matched sport, coach name, athlete name. "This is me" → next; "Not me" → back to step 1.
- `src/routes/signup.athlete.account.tsx` — Step 3. Email + password fields (shadcn `Input` + `Label` + `Button`). Inline errors.
- `src/routes/_authenticated/athlete.tsx` — placeholder dashboard.
- Update `src/routes/index.tsx` to enable the athlete `RoleButton` (remove `disabled: true`).

## Server functions (new file `src/lib/athlete-signup.functions.ts`)

- `getAthleteInviteSummary({ code })` — **public** (no `requireSupabaseAuth`, uses `supabaseAdmin`). Looks up `athlete_invite_codes` by code; validates `used_at IS NULL` and `expires_at > now()`. Joins to `athletes`, `coach_athletes`, `coach_profiles`, `athlete_goals` (for sport) and `coach_levels` (fallback). Returns `{ athleteFirstName, athleteLastName, sports: string[], coachFirstName, coachLastName }`. **Sport logic:** prefer `athlete_goals.sport` rows for this athlete+coach; if empty, fall back to the coach's `coach_levels` sports. (Matches "show only sports this athlete works with this coach on.")
- `claimAthleteInvite({ code })` — protected with `requireSupabaseAuth`. Re-validates the code, sets `athletes.user_id = auth.uid()` for the linked athlete, writes `used_at = now()` and `claimed_by = auth.uid()` on the code row. Idempotent (no-op if already claimed by same user).

Account creation itself uses `supabase.auth.signUp({ email, password })` directly on the client (browser client), then calls `claimAthleteInvite` once the session is live. This keeps the password out of server logs and matches how the parent flow signs up.

## Data & security

- Existing `athletes.user_id` column is already nullable — no schema change needed.
- `athlete_invite_codes` RLS already restricts parents to their own rows; the lookup goes through `supabaseAdmin` (intentional, public by code).
- New `getMyRole` case: if `athletes.user_id = auth.uid()` (and no coach/parent profile), return `role: "athlete"`. Update `/login` post-login routing and `/` `beforeLoad` to send athletes to `/athlete`.
- `_authenticated` layout already handles the auth gate for `/athlete`.

## Validation rules

- Code: trimmed, uppercased, length 8, `^[A-Z2-9]+$` (matches existing `INVITE_ALPHABET`).
- Email: zod email, max 255, trim+lowercase.
- Password: min 8 chars (matches Supabase default).
- All errors surfaced inline below the relevant field; no toasts for form errors.

## Out of scope (v1)

- Google sign-up (per your choice).
- Athlete editing their own profile/sport.
- Phone/OTP path (the `athlete_otp_challenges` table stays untouched).
