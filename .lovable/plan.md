## Why you saw "No authorization header was provided"

On `/signup/parent` the page does two things back‑to‑back:

1. `supabase.auth.signUp({ email, password, … })`
2. `startParentSignup({ data: { firstName, lastName, code } })` — a server function guarded by `requireSupabaseAuth`.

When email confirmation is enabled (our current policy — and it should stay on), `signUp` does **not** return a session until the user clicks the confirmation link. So between steps 1 and 2 there is no Supabase session in the browser, `attachSupabaseAuth` has no bearer token to attach, and the server middleware rejects the call with *"No authorization header provided"*.

The athlete signup flow (`signup.athlete.account.tsx`) already handles this: if `signUp` returns no session, it immediately calls `signInWithPassword` to establish one before invoking the protected server function. The parent flow is missing that fallback.

## Fix

Mirror the athlete pattern in `src/routes/signup.parent.tsx` — only this one file changes.

In `handleSubmit`, after the existing `supabase.auth.signUp(...)` call, capture its result and, if no session was returned, fall back to signing in with the same credentials before calling `startParentSignup`:

```ts
const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: window.location.origin + "/parent",
    data: { full_name: `${firstName} ${lastName}`.trim() },
  },
});
if (signUpErr) throw signUpErr;
if (!signUp.session) {
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) throw signInErr;
}
```

The branch only runs when the user is not already authed (the existing `if (!sessionData.session)` block). Everything else in the file — the `start({ data: … })` call, navigation to `/signup/parent/athletes`, error handling — stays the same.

## Notes / non‑changes

- No server function changes. `startParentSignup` and `requireSupabaseAuth` are correct.
- No change to `src/start.ts`; `attachSupabaseAuth` is already wired into `functionMiddleware`.
- Email confirmation stays enabled. Sign‑in‑after‑signup with the same password is safe because the user just supplied it on this form.
- If the email is already registered, `signUp` will error and we surface that to the user as today — no silent account takeover.
