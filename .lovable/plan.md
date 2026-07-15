# Move invite & promo inputs off page 1 of signup

Goal: simplify the first screen of the three signup entry points (parent, coach, adult athlete) by removing the "coach/parent invite code" and "promo code" input fields. Codes that arrive via a shared link (`/i/CODE` → `?invite=CODE`) or a URL-attached promo (`?promo=CODE`) keep working transparently — they just no longer appear as visible fields on page 1.

## What changes

### `src/routes/signup.parent.tsx` (page 1)
- Remove the visible "Coach invite code" input block and the `PromoCodeField` block.
- Keep everything else: URL search parsing (`invite`, `promo`), the `useEffect` that stashes them, and the existing calls to `savePendingPromoCode()` and `sessionStorage.setItem(PENDING_PARENT_COACH_CODE_KEY, ...)` inside `stashPending()`.
- Change `stashPending()` to read the code from `search.invite` (URL) and `search.promo` (URL) instead of local input state. Drop the `code`/`promoCode` local `useState`, the `trimmedCode`/`codeValid` derivations, and the "Invite code must be 8 characters" submit guards (URL codes are already validated by `searchSchema`).
- Preserve the navigation to `/signup/parent/athletes` with `search: search.invite ? { code: search.invite } : {}`.

### `src/routes/signup.parent.athletes.tsx` (page 2)
- Add a visible "Coach invite code (optional)" input, prefilled from either the `?code=` search param or `sessionStorage[PENDING_PARENT_COACH_CODE_KEY]` (both already flow in — the file already reads the sessionStorage key at line 48).
- Add a `<PromoCodeField>` block. Because page 2 renders only after the profile row exists, we can either (a) keep the existing "stash and apply after signup" pattern for consistency, or (b) call `applyPromoCodeToMyProfile` directly on submit. Recommend (a) to reuse existing plumbing.
- Wire the new coach-code input into the existing linking logic on this page. If none exists yet on this page, add a call to `claimParentInvite`/lookup identical to what page 1 does today when the parent proceeds.

### `src/routes/signup.coach.tsx` (page 1)
- Remove the visible "Athlete or parent invite code" input and `PromoCodeField` blocks.
- Keep the personalized welcome banner (`{invite && (parentName || adultAthleteName) && …}`) — it's driven by the URL param, not the input.
- Keep the URL-stash effect (`localStorage.setItem(PENDING_INVITE_KEY, invite)`), the auto-claim effect for signed-in users, and pass the URL invite through to `stashPending()`. Drop the local `inviteCode` state and its validation.
- Page 2 for coaches is `src/routes/_authenticated/coach.onboarding.tsx`, which already has an `"invite"` step (`InviteCard`) and already reads `PENDING_INVITE_KEY` from localStorage. That page needs no changes for the invite flow. Add a `PromoCodeField` there in a natural spot (e.g. the review step) and call `applyPromoCodeToMyProfile` on completion, reading the stashed promo from `sessionStorage`.

### `src/routes/signup.athlete.adult.tsx` (page 1)
- Remove the visible coach-code and promo inputs. Keep the URL parse, the `useEffect` that writes `PENDING_COACH_INVITE_KEY` to localStorage, and the `savePendingPromoCode` call inside `stashPending()` — feed both from `search.invite`/`search.promo` instead of local state.
- Page 2 is `src/routes/_authenticated/athlete.onboarding.tsx`, which already prefills from `localStorage["gradus.pendingCoachInvite"]` (lines 372–385) and already shows the coach-code input. No changes needed there for invites. Add a `PromoCodeField` (e.g. on the final step) that reads the stashed promo and applies it.

### Shared code
- No changes needed to `src/routes/i.$code.tsx`, `src/lib/pending-promo-code.ts`, `src/components/signup/promo-code-field.tsx`, or the invite-resolve server fns.
- The `PENDING_PARENT_COACH_CODE_KEY`, `PENDING_COACH_INVITE_KEY`, and `PENDING_INVITE_KEY` storage contracts stay the same, so the OAuth round-trip (Google sign-in) continues to survive.

## Impact on shared-link users

Zero. A user who clicks `https://gradus.training/i/ABCD2345`:

1. Hits `/i/ABCD2345` → resolved → redirected to `/signup/parent?invite=ABCD2345` (or `/signup/coach`, `/signup/athlete/adult`).
2. Page 1 no longer *shows* the code, but still parses it from the URL, stashes it before OAuth, and forwards it as a search param when navigating to page 2.
3. Page 2 prefills the input from the stashed code and completes the link.

The only behavioral shift: a user who was given a code verbally and lands on `/signup/parent` with no URL param now enters it on page 2 instead of page 1.

## Files touched

- Edit: `src/routes/signup.parent.tsx`
- Edit: `src/routes/signup.coach.tsx`
- Edit: `src/routes/signup.athlete.adult.tsx`
- Edit: `src/routes/signup.parent.athletes.tsx` (add invite input + promo field + wiring)
- Edit: `src/routes/_authenticated/coach.onboarding.tsx` (add promo field on review step)
- Edit: `src/routes/_authenticated/athlete.onboarding.tsx` (add promo field)

## Verification

- Load `/i/<valid-coach-code>` signed out → picks role → lands on `/signup/parent?invite=…` with no visible code field → completes email signup → page 2 shows the code prefilled → submitting links the coach.
- Same flow with Google OAuth (verifies the sessionStorage/localStorage stash still bridges the redirect).
- Load `/signup/parent` directly (no URL param) → page 1 has no invite/promo fields → page 2 shows both, both optional.
- Load `/signup/parent?promo=FRIENDS10` → page 1 hides the field → promo applied after profile creation on page 2.
- Coach flow: `/i/<parent-code>` → `/signup/coach?invite=…` still shows the "Kim invited you" banner, no input field, auto-claim on completion.
