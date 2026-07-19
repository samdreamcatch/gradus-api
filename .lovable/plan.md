## Goal

Give every signed-in user (coach, parent, athlete) a consistent way to:
- Send themselves a password reset email
- Send themselves a magic link (useful if they forget their password on another device)
- Change their email address (with Supabase's default double-confirm)

Reauthentication is not a standalone action — it's requested just-in-time by Supabase when required (e.g. during email change), and we handle its prompt inline.

Zero impact to signup / onboarding: no route guards change, no auth config change, no email template change (existing recovery, magic-link, and email-change templates already ship).

## What's built

### 1. New shared component: `src/components/settings/AccountSecuritySection.tsx`

Rendered inside a `Card` (matches the existing settings look). Contains four rows using the existing settings row pattern:

- **Reset password** — button opens a small inline confirm; on confirm calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: \`${window.location.origin}/reset-password\` })`. Toast: "Reset link sent to {email}". Uses existing `/reset-password` route — no new route needed.
- **Send magic link** — calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin, shouldCreateUser: false } })`. Toast: "Magic link sent to {email}". `shouldCreateUser:false` prevents accidental new-account creation.
- **Change email** — opens a `Sheet` (bottom on mobile, side on desktop, per overlay doctrine) with:
  - Current email (read-only)
  - New email input + confirm input
  - Submit calls `supabase.auth.updateUser({ email: newEmail })`.
  - If Supabase returns `reauthentication_needed` (AuthApiError code), we call `supabase.auth.reauthenticate()`, show a nonce input, then retry `updateUser({ email, nonce })`.
  - Success toast: "Check both inboxes to confirm the change."
- **Rate-limit / error handling**: catches `over_email_send_rate_limit` and surfaces a friendly toast; all other errors surfaced via existing `toast.error`.

All three email actions read the current email from the existing `useCurrentUserEmail()` hook — no server function needed; these Supabase auth calls run client-side using the browser client.

### 2. Wire the section into all three settings pages

Add `<AccountSecuritySection />` to:
- `src/routes/_authenticated/coach.settings.tsx` — above the existing "Sign out" row
- `src/routes/_authenticated/parent.settings.tsx` — above the existing "Sign out" row
- `src/routes/_authenticated/athlete.settings.tsx` — above the existing "Sign out" row

Same component, same order in all three so users get a consistent experience.

### 3. No changes to

- `/reset-password` route (already exists and handles the recovery link).
- Auth email templates (signup, recovery, magic-link, email-change, reauthentication are all already scaffolded).
- Supabase auth config (double-confirm email change is already the default).
- Signup / onboarding flows.
- Route guards.

## Technical notes

- All calls use `supabase` from `@/integrations/supabase/client` — browser only, respects the current session.
- Reauthentication path uses Supabase's built-in `reauthenticate()` + `nonce` pattern; the existing `reauthentication` email template renders the code.
- Change-email double confirm: Supabase sends `email_change` messages to both old and new addresses; the change only takes effect once both confirm — no code needed on our side for that logic.
- `resetPasswordForEmail` `redirectTo` points to the existing `/reset-password` page, which already calls `supabase.auth.updateUser({ password })` on submit.
- If a user hits GoTrue's hourly `over_email_send_rate_limit`, the toast tells them to try again in a bit; raising the limit is a separate admin action (`supabase--configure_auth` with `rate_limit_email_sent`), not part of this plan.

## Out of scope

- Delete account (separate flow, not requested).
- Standalone "Reauthenticate now" button (per your answer, just-in-time only).
- 2FA / MFA enrollment (not requested).
