## Goal

Remove the "Continue with Google" option everywhere it appears in the app, and disable the Google provider on the backend so no one can complete a Google flow even if they hit an old link.

## Scope

Google sign-in currently appears in two places:

- `src/routes/login.tsx` — "Continue with Google" button above the email/password form.
- `src/routes/signup.coach.tsx` — "Continue with Google" button in the coach signup flow.

The parent, athlete, and admin signup flows do not offer Google, so they need no changes.

## Changes

### 1. `src/routes/login.tsx`
- Remove the Google button, the "or" divider between it and the email form, and the `handleGoogle` function.
- Remove now-unused imports: `lovable`, `verifyTurnstileToken`, and the `verifyCaptcha = useServerFn(verifyTurnstileToken)` line.
- Leave the Turnstile widget in place — it still guards the email/password path.

### 2. `src/routes/signup.coach.tsx`
- Remove the Google button, `handleGoogle`, `doGoogleSignup`, and the `"google"` branch of `PendingAction` (narrow it to `"email"`).
- Remove any now-unused imports (`lovable`, related helpers) and simplify the pending-action flow so it only handles the email path.

### 3. Backend
- Disable the Google provider on Lovable Cloud so the OAuth endpoint stops accepting requests. Keep email enabled.

## Notes

- The `src/integrations/lovable/` module is auto-managed by the integration and stays as-is; we simply stop importing from it. If the user later wants Google back, we re-enable the provider and restore the buttons.
- No database migration or route file deletion is needed.
