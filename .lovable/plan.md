## Goal

When a parent invites an athlete, the parent **texts (or shows) an 8-character code** to the athlete. The athlete enters that code, verifies their phone number via SMS OTP, and from then on logs in with **phone + SMS OTP** — no email, no password, no PIN.

QR code becomes a nice-to-have for in-person ("scan with camera"), not the primary path.

## Flow

### Parent side (already mostly built)
1. Parent goes to "Add athlete" → enters athlete's name (+ optional DOB / sport).
2. App generates an 8-char invite code (already implemented via CSPRNG).
3. Parent sees the code with three share affordances:
   - **Copy code** (default)
   - **Share via SMS** (`sms:` link prefilled with "Join me on Gradus: <code> → gradus.app/join")
   - **Show QR** (for in-person)

### Athlete side — first time (claim)
1. Athlete opens `/join` (or `/join?code=XXXXXXXX` from the deep link).
2. Screen 1: Enter 8-char code → server validates code is unclaimed + not expired.
3. Screen 2: "Confirm you're <athlete name>" (shows the name the parent typed) + enter phone number.
4. Server sends SMS OTP to that phone, creates the Supabase user with that phone (no email, no password), and on OTP verify:
   - Marks invite code as `claimed_at = now()` and `claimed_by = auth.uid()`.
   - Links the new auth user to the existing `athletes` row (sets `athletes.user_id`).
   - Adds a `user_roles` row with role `athlete`.
5. Athlete lands on `/athlete` dashboard.

### Athlete side — future logins
- `/login` already exists. Add a **"Continue with phone"** option that sends an SMS OTP and signs them in. Phone-only Supabase Auth handles this natively.
- Role check in router sends them to `/athlete` instead of `/coach` or `/parent`.

### Invite code lifecycle
- **Single-use, 30-day expiry.** Once claimed, the code is dead.
- If athlete loses access (new phone, lost number): parent generates a new invite from their dashboard, which re-binds the existing athlete row to the new phone (replaces `athletes.user_id`).

## What we're explicitly NOT doing
- No PIN, no password for athletes.
- No email collection for athletes.
- No device-bound tokens or magic links.
- No automatic re-use of expired codes.

## Technical details

### DB changes (one migration)
- `athletes` table: add `user_id uuid` nullable (FK conceptually to `auth.users`, but per project rules we don't FK to auth — just store the uuid). Add unique index.
- `parent_athlete_invites` (or whatever the current table is called — confirm name during build): add `claimed_at timestamptz`, `claimed_by uuid` if not already present.
- New helper server fn `claimAthleteInvite({ code, phone })` and `verifyAthleteOtp({ phone, token })` in `src/lib/athlete-signup.functions.ts` (uses `supabaseAdmin` to provision the phone user + link the athlete row).
- Add `'athlete'` to the existing `app_role` enum if not present.
- RLS on `athletes`: add policy "athlete can read/update their own row" using `auth.uid() = user_id`.

### Supabase Auth config
- Enable phone provider (SMS) via `configure_auth` — will prompt the user to confirm an SMS provider (Twilio/MessageBird) is set up in Lovable Cloud, since SMS costs money. **I'll flag this before flipping the switch.**

### Routes
- New: `src/routes/join.tsx` (public) — 3-step wizard: code → confirm name + phone → OTP.
- New: `src/routes/_authenticated/athlete.tsx` — basic dashboard placeholder.
- Edit: `src/routes/login.tsx` — add "Sign in with phone" path alongside existing email login.
- Edit: parent's athlete-creation screen (`src/routes/_authenticated/parent.athletes...`) — replace "QR only" share UI with code + SMS share + QR.
- Edit: router redirect-by-role logic to route `athlete` → `/athlete`.

### What I'll confirm during build
- Whether the existing `parent_signup.functions.ts` invite logic already has a `claimed_at` column or needs the migration to add it.
- Exact route file names for the parent athlete management screen (a few candidates exist).

## Open question before I build

**Do you already have an SMS provider (Twilio etc.) set up, or do I need to walk you through enabling one in Lovable Cloud?** SMS OTP won't work until that's configured. If not, I can build the entire flow against email-link fallback first and you flip phone on later — but that defeats the point.
