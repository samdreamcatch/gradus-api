# Fix sender name on account emails, then turn on email verification

## What changes
1. **Sender name** — account emails (sign-up confirmation, password reset, magic link, email change, invite, re-verify) say "Gradus Training" instead of "gradussportsapp", matching every other Gradus email.
2. **Check before switching on** — confirm the sign-up confirmation email actually arrives in the Gradus style by sending a test, and look into the 157 earlier emails that failed permanently so we know they aren't account emails that would fail the same way.
3. **Sign-up screens** — make sure that after signing up, coaches, parents and athletes see a clear "Check your email to confirm" message (not a broken or silent screen), and that the confirmation link brings them back signed in. That includes the iPhone app, which uses the gradus.training link.
4. **Turn on verification** — new sign-ups must confirm their email before signing in. Existing accounts are unaffected. Dev/demo accounts created by the seed stay usable.
5. **Email limit** — raise the hourly limit on account emails so a busy sign-up day (e.g. at a competition) doesn't block confirmations.

## Order and safety
Verification is switched on only after steps 1–3 pass. If the test email fails, I stop and report back instead of switching it on, so nobody gets locked out.

## Technical details
- `src/routes/lovable/email/auth/webhook.ts` line 39: `SITE_NAME` → "Gradus Training" (keep signature verification, payload contract and enqueue call untouched).
- Inspect `email_send_log` / DLQ for the dead-lettered messages, grouped by `template_name`.
- Review signup routes/handlers for the `session === null` (confirmation pending) branch and `emailRedirectTo` pointing to `https://gradus.training/auth/callback`; confirm seeded test users are created pre-confirmed.
- `supabase--configure_auth`: `auto_confirm_email: false`, passing current values for `disable_signup`, `password_hibp_enabled`, anonymous users; `rate_limit_email_sent` raised (e.g. 200/hr).
- Run typecheck, lint and tests. Live site changes need Mariah's review and publish; the verification switch itself takes effect immediately on the shared backend, so it is flipped last, after the code is published.
