# Open signups + add Turnstile CAPTCHA

Replace the beta code gate on **coach** and **parent** signup with Cloudflare Turnstile, and add Turnstile to **login** and **password reset**. Keep the beta code on `/signup/admin` (admin should stay vetted). No email auth is enabled — Google + existing email/password flows only.

## Provider choice: Cloudflare Turnstile

- Free, no visible puzzles in the common case (managed challenge).
- Privacy-friendly (no ad-tech tracking).
- Officially supported by Supabase Auth — token is passed via `options.captchaToken` on `signUp`, `signInWithPassword`, `resetPasswordForEmail`.
- Works with Lovable's Google OAuth broker: Turnstile guards the "Continue with Google" *button* client-side; the OAuth broker itself is not directly protected, but bots can't kick off the flow without solving the challenge.

## What changes

### 1. Remove beta code from coach + parent signup
- `src/routes/signup.coach.tsx`: delete the beta code input, `validateSignupCode` call, and the disabled-until-8-chars logic.
- `src/routes/signup.parent.tsx`: same treatment if a code field is present.
- Keep `src/routes/signup.admin.tsx` code-gated as-is.
- Keep the Terms-of-Service checkbox.
- `BETA_INVITE_CODE` secret stays (still used by admin). `validateSignupCode` server fn stays, just no longer called from coach/parent.

### 2. Add Turnstile widget

Create `src/components/auth/turnstile.tsx` — a small wrapper around Cloudflare's `<script>` + `cf-turnstile` div that:
- Loads `https://challenges.cloudflare.com/turnstile/v0/api.js` once.
- Renders an invisible/managed widget with the site key from `VITE_TURNSTILE_SITE_KEY`.
- Exposes `onVerify(token)` and `reset()`.
- Auto-resets after a successful sign-up/sign-in attempt (tokens are single-use).

Mount it in:
- `src/routes/signup.coach.tsx`
- `src/routes/signup.parent.tsx`
- `src/routes/login.tsx`
- Wherever password reset lives (add if missing — see "Open questions").

Disable the primary submit / Google button until `captchaToken` is present.

### 3. Verify token server-side

Two paths, both need protection:

**a. Email/password sign-up and sign-in (Supabase native):**
Pass the token straight to Supabase — it verifies against Cloudflare:
```ts
supabase.auth.signUp({ email, password, options: { captchaToken, ... } })
supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })
supabase.auth.resetPasswordForEmail(email, { captchaToken, redirectTo })
```
This requires **enabling CAPTCHA in the Lovable Cloud auth settings** (Provider: Turnstile, paste the secret key). Once enabled, Supabase rejects any auth call without a valid token — belt-and-suspenders.

**b. Google OAuth (via `lovable.auth.signInWithOAuth`):**
The Lovable broker doesn't accept a captchaToken parameter, so we verify client-side gating only: the Google button is disabled until Turnstile fires, and the token is consumed by a lightweight server fn (`verifyTurnstileToken`) before we call `lovable.auth.signInWithOAuth`. This blocks scripted OAuth initiations from the browser but is not as strong as native Supabase enforcement.

Create `src/lib/turnstile.functions.ts`:
```ts
export const verifyTurnstileToken = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY!,
        response: data.token,
      }),
    });
    const body = await res.json();
    if (!body.success) throw new Error("CAPTCHA verification failed");
    return { ok: true };
  });
```
Call it before the Google OAuth kickoff on coach signup, parent signup, and login.

### 4. Secrets + config
- **Runtime secret** (via `add_secret`): `TURNSTILE_SECRET_KEY` — obtained from Cloudflare dashboard.
- **Public site key**: `VITE_TURNSTILE_SITE_KEY` in `.env` (safe to commit; it's public by design).
- Enable Turnstile in Lovable Cloud auth settings after secrets are in place.

## Implications (what the user needs to know)

1. **Anyone can now create a coach or parent account.** Beta positioning is gone for those roles. Onboarding traffic is no longer throttled by handing out codes.
2. **Admin signup stays code-gated** — this is the safe default; admins should never be self-serve.
3. **No new dependencies on email auth.** Google OAuth continues to work; email/password continues to work exactly as today.
4. **Password reset gets protection too**, closing a common credential-stuffing vector.
5. **Very low UX cost.** Turnstile is invisible for the vast majority of users; a small "Verifying you're human…" indicator sits by the submit button.
6. **Attribution loss.** You lose the "which cohort / campaign issued this code" signal. If you want that back later, add a `?ref=` query param captured into the profile row at signup.
7. **Instant shut-off.** Today you can kill signups by rotating `BETA_INVITE_CODE`. After this change, the equivalent kill-switch is toggling `disable_signup` in Cloud auth settings (still one action, different location).
8. **Bot-abuse ceiling.** Turnstile stops casual scripted signups. Determined attackers using CAPTCHA-solving services can still get through — if abuse becomes real, add per-IP rate limiting on `verifyTurnstileToken` and Supabase auth webhook signals.
9. **Slight bundle cost.** ~15KB of Cloudflare script loaded on the four auth pages only.

## Rollout order

1. User creates a Turnstile site + secret key in their Cloudflare dashboard.
2. Add `TURNSTILE_SECRET_KEY` via `add_secret`; add `VITE_TURNSTILE_SITE_KEY` to `.env`.
3. Ship the Turnstile component + `verifyTurnstileToken` server fn.
4. Wire it into coach signup, parent signup, login, password reset.
5. Enable CAPTCHA in Cloud auth settings (Turnstile + paste secret).
6. Remove beta code UI from coach + parent signup.
7. Smoke test all four flows (email signup, Google signup, email login, Google login, password reset) as coach and parent.

## Open questions (not blocking approval)

- Do you currently have a `/reset-password` route + "Forgot password" link? I don't see one in the routes list — if not, I'll add both as part of step 4.
- OK to leave the beta code active on `/signup/admin`? (Strong recommendation: yes.)
