## Goal

Unify the three adult signup entry points (coach, parent, adult athlete) into the same layout, with the "commitment" fields (invite code, promo code, Terms) **above** the "credentials" fields (email/password, Google), matching today's coach page.

## Shared field order (all three routes)

Every adult signup page renders in this exact order, top to bottom:

1. Header ("Create your {role} account")
2. Context banner (only when an invite is attached, e.g. "You're connecting with Coach Jane")
3. **Terms of Service** checkbox
4. **Optional invite code** (audience-specific label)
5. **Promo code** (optional)
6. Divider
7. Email + password fields
8. Continue button
9. "or" divider
10. Continue with Google button
11. Footer link ("Wrong role?" / "Under 18?")

Signup is only enabled once ToS is checked. Any invite-code / promo-code entered above is stashed via the existing `sessionStorage` helpers before the Supabase call, so it survives the email-verify or Google round-trip.

## Per-route changes

### `/signup/coach`
- Already has this ordering; add one new field: **optional "Athlete or parent invite code"** input, placed with promo code above the divider.
- Seed the input's initial value from `Route.useSearch().invite` so an OG deeplink pre-fills it.
- On submit, stash the entered code under `PENDING_INVITE_KEY = "gradus.pendingParentInvite"` — the coach onboarding already claims it and falls back parent→adult-athlete.

### `/signup/parent`
- Reorder to the shared shape: move ToS + coach-invite + promo **above** email/password.
- Keep the existing search-prefill for `invite` and `promo` (already wired).
- Add a **Continue with Google** button using the same broker helper as coach (`lovable.auth.signInWithOAuth("google", { redirect_uri: origin + "/signup/parent/athletes" })`). Invite + promo are already stashed pre-auth, so they survive the round trip.

### `/signup/athlete/adult`
- Reorder to the shared shape.
- Remove first name, last name, **and birthdate** from this screen entirely.
- Add an **optional "Coach invite code"** input, seeded from `Route.useSearch().invite`, stashed under the existing `PENDING_COACH_INVITE_KEY` (already consumed by athlete onboarding's CoachStep to prefill + auto-preview).
- Add **Continue with Google** (`redirect_uri = origin + "/athlete/onboarding"`).
- Move name + DOB collection to a **new first step in athlete onboarding** ("Tell us about yourself": first name, last name, date of birth). That step calls `createSelfManagedAthlete` before advancing to the existing coach → goals → schedule steps. `enforce_adult_self_managed` DB trigger stays the authoritative age gate.
- Keep the "Under 18? Use a parent invite code" footer link.

## Invite-code prefill on OG-shared links (verified)

`/i/$code` already dispatches signed-out users into the signup routes with `?invite=CODE`. Each signup route's Zod search schema already accepts `invite`. Concrete behavior after this change:

| Sender's link | Route landed on | Behavior |
|---|---|---|
| Parent shares parent code | `/signup/coach?invite=…` | Code visible in the new coach invite-code input, editable |
| Adult athlete shares their code | `/signup/coach?invite=…` | Same input; coach onboarding falls back parent→adult-athlete claim |
| Coach shares coach code → user picks "I'm a parent" | `/signup/parent?invite=…` | Code visible in existing parent invite-code input |
| Coach shares coach code → user picks "I'm an adult athlete" | `/signup/athlete/adult?invite=…` | Code visible in the new adult-athlete invite-code input |
| Under-18 athlete claim link | `/signup/athlete/confirm?code=…` | Unchanged (separate flow, out of scope) |

Under-18 (`/signup/athlete`) and its confirm step are unchanged.

## Technical notes

- No DB migrations; no server-fn signature changes. `createSelfManagedAthlete` still takes `{ firstName, lastName, birthdate }`, just called from onboarding instead of the signup page.
- Google button on parent + adult-athlete uses `lovable.auth.signInWithOAuth("google", { redirect_uri })` with a public same-origin `redirect_uri`; invite/promo state is preserved via the existing sessionStorage stashes, not through `redirect_uri`.
- ToS gating already blocks submit when unchecked; port that behavior to any route where it currently only shows an inline hint.
- `_authenticated.tsx`'s existing effect applies the stashed promo code + ToS acceptance once the session lands, so no changes there.

## Out of scope

- Account-collision UX (same email as a different role).
- Friendly dual-role trigger error messages.
- Under-18 flow.
