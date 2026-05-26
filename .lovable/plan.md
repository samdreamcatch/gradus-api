# Slice 1 — Coach Auth (Email + Google)

Goal: a coach can sign up / log in with email-password or Google, land on `/coach`, see "Signed in as {name or email}", and sign out. Nothing else.

## Scope (in)
- Enable Lovable Cloud (Supabase).
- Email/password auth + Google OAuth.
- Routes: `/login`, `/coach` (protected), `/` redirects to `/coach` or `/login`.
- Session persistence + auth state listener.
- Sign-out button.
- Design system primitives wired (Fraunces + Atkinson Hyperlegible fonts, paper background, pen tokens, ruled lines) so future slices inherit the look.

## Scope (out, deferred to later slices)
- `coaches` table / profile row, sports, levels, parent/athlete roles, invites, plans, moves, sessions, messages, schedules, RLS for domain tables, AppBackground polish beyond basics, role selector screen from wireframe.

For Slice 1 we use `auth.users` only. The `coaches` table and onboarding (profile → sports → levels) come in Slice 2 so this slice stays narrow.

## Architecture

```text
src/
  routes/
    __root.tsx              shell + QueryClient + auth context provider
    index.tsx               redirects to /coach or /login
    login.tsx               email/password + Google buttons (public)
    _authenticated.tsx      beforeLoad guard → redirect /login if no session
    _authenticated/
      coach.tsx             "Signed in as X" + Sign out
  lib/
    auth-context.tsx        useAuth hook, session state, login/logout/google
  styles.css                Gradus tokens (paper bg, pen palette, fonts)
  components/
    AppBackground.tsx       paper wash + ruled lines (minimal)
```

## Auth model
- Supabase client (browser) with `localStorage` session persistence.
- `onAuthStateChange` listener set up BEFORE initial `getSession()` (avoids the deadlock).
- Router context carries `{ auth: { isAuthenticated, user, signOut, ... } }` so `_authenticated.beforeLoad` can synchronously gate.
- During the very first hydration we render a tiny "Loading…" until the initial `getSession()` resolves, then mount the router with hydrated context.

## Pages

**`/login`**
- Centered card on paper background.
- Tabs or stacked: Email + Password (sign in / sign up toggle), divider, "Continue with Google" button.
- Sign-up uses `emailRedirectTo: window.location.origin`.
- Google uses `signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/coach' } })`.
- On success → navigate to `search.redirect ?? '/coach'`.

**`/coach`** (under `_authenticated`)
- Single Fraunces heading: "Signed in as {user.user_metadata.full_name ?? user.email}".
- Sign-out button (calls `supabase.auth.signOut()`, navigates to `/login`).

**`/`**
- `beforeLoad`: redirect to `/coach` if authed else `/login`.

## Design system bootstrap (lightweight)
- Add Google Fonts links (Fraunces, Atkinson Hyperlegible, Caveat) in root `head`.
- Replace `src/styles.css` token block with the Gradus tokens from the design system doc (surfaces, ink ramp, pen palette, radii). Default pen = Tennis.
- Add minimal `AppBackground` (paper wash gradient + ruled lines via repeating-linear-gradient). Skip SVG grain for now.
- shadcn Button/Input/Card retained; tokens map so they pick up the new look automatically.

## Google OAuth setup
Google provider needs to be enabled in the Lovable Cloud auth settings with a Client ID + Secret from a Google Cloud OAuth app. I will:
1. Enable Lovable Cloud.
2. Build the UI calling `signInWithOAuth({ provider: 'google' })`.
3. Prompt you to add the Google OAuth credentials (I'll give the redirect URI to paste into Google Cloud Console).

The email/password path works immediately with no extra config.

## Acceptance criteria
- Visiting `/coach` while signed out redirects to `/login` (no flash).
- Email sign-up creates a user; subsequent sign-in works; refresh keeps you signed in.
- Google button completes OAuth and lands on `/coach`.
- `/coach` shows the user's name or email and a working Sign out that returns to `/login`.
- No other routes or domain tables exist yet.

## Test plan
- Manual: sign up new email → land on `/coach` → refresh → still signed in → sign out → redirected to `/login` → sign back in.
- Manual: direct-visit `/coach` while signed out → redirected to `/login?redirect=/coach` → after login lands on `/coach`.
- Manual: Google flow once credentials are configured.
- Check console for auth errors; check network for 200 on `/auth/v1/token`.
