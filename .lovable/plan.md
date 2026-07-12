## New signup layout (`signup.coach.tsx`)

```text
Header + invite banner

[ ] I agree to the Gradus Terms of Service (v2)   ← shared gate, on top
    ↳ inline hint if user tries to submit unchecked

Email
Password
Promo code (optional)
[ Continue ]                                      ← email/password path

------- or -------

[ Continue with Google ]                          ← now BELOW promo code
```

Rationale: putting Google last means the user scans past the promo field before it becomes an option, so promo codes stop getting forgotten. ToS stays on top as the visible gate for both paths.

Behavior:
- Both `Continue` and `Continue with Google` are gated on `agreed === true`.
- If unchecked, clicking either shows an inline "Please accept the Terms to continue." under the checkbox instead of a silent disabled state.
- Promo code value is read from the same form state for both flows — Google path continues to stash it via `stashPendingAccept()` before redirect, same as today.

## Tightening stale-localStorage risks

Four small changes across the pending-accept plumbing — no schema changes.

### 1. Timestamp + expiry on the stash
`src/lib/pending-promo-code.ts` and `src/lib/terms.ts` (or wherever `stashPendingAccept` lives) start writing `{ value, stashedAt: Date.now() }` instead of a bare string. A `readPendingAccept()` helper returns `null` and clears the key if `stashedAt` is older than 15 minutes. This kills the "OAuth cancelled last week, promo applied to a different account today" leak.

### 2. Clear on OAuth cancel / error
In `signup.coach.tsx` and `login.tsx`, wrap the `lovable.auth.signInWithOAuth` call so that if `result.error` is set (user cancelled, popup blocked, provider error) we call `clearPendingAccept()` immediately. Right now we only clear on success.

### 3. Fix the `"athlete"` gap in `_authenticated.tsx`
Today `signup.athlete.adult.tsx` writes `PENDING_TERMS_ACCEPT_KEY = "athlete"` but the `_authenticated` effect only branches on `"coach" | "parent"`, so that key sits in localStorage forever. Two options:
- **Preferred:** stop encoding role in the stash — write just `{ stashedAt }` and let `_authenticated` derive the role from the actual server profile (`useMyProfile` / whatever the layout already loads). Simpler, no per-role branches to maintain.
- Alternative: add the `"athlete"` branch. Rejected — same class of bug will reappear when a new role is added.

Going with option 1.

### 4. Debounce the promo retry loop
`applyPromoCodeToMyProfile` currently re-fires on every authed pathname change until the `coach_profiles` row exists. Cap it: track an attempt counter in a ref, stop after 5 attempts, and toast `success("Promo code applied")` on the attempt that returns `applied: true`. If we exhaust attempts, clear the stash and toast a soft failure ("We couldn't apply your promo code — enter it in Settings.").

## Files touched

- `src/routes/signup.coach.tsx` — reorder JSX (ToS → email/password/promo → Continue → divider → Google), lift ToS checkbox out of the `<form>`, add inline hint, clear stash on OAuth error.
- `src/routes/login.tsx` — clear stash on OAuth error (no reorder; login page has no promo field).
- `src/lib/pending-promo-code.ts` — timestamped stash + 15 min expiry + `clearPendingAccept()`.
- `src/lib/terms.ts` — same timestamp/expiry treatment for the ToS stash, drop role from the payload.
- `src/routes/_authenticated.tsx` — read role from server profile instead of stashed value; add 5-attempt cap on promo retry; success/failure toast.
- `src/routes/signup.athlete.adult.tsx` — drop the `"athlete"` role write (now unnecessary).
- `src/routes/signup.parent.tsx` — same drop-role update to keep the two signup pages consistent.

No DB migration. No changes to Turnstile, `_authenticated` gate, or the OAuth broker wiring.
