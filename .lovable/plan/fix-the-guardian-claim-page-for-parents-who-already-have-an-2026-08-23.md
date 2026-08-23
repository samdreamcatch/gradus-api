# Fix the guardian claim page for parents who already have an account

## What happened

The coach added "Leo Gillespie" and emailed mariah.slone+1@gmail.com. That account already exists as a parent (Mariah Gillespie) and already has an athlete on it — "Leon Gillespie". Confirmed in the data: the pending invite athlete is `Leo Gillespie`, and the athlete on that parent account is `Leon Gillespie`.

Two things made the page look like a cold signup:

1. **Name fields shown to an existing parent.** The page always asks "Your first name / Your last name". It has no idea a parent profile already exists, so a returning parent is asked to introduce themselves again.
2. **The "is this your existing athlete?" prompt never appeared.** That prompt only offers athletes whose full name matches the invite *exactly*. "Leo Gillespie" != "Leon Gillespie", so Mariah was silently offered a brand-new duplicate athlete instead of the chance to attach the coach to Leon.

There is also a smaller flaw: while the sign-in state is still being read, the page renders the claim form. A signed-out visitor briefly sees the form before the "Sign in" button replaces it.

## The fix

**Recognize the signed-in parent.**
The page asks the server who the claimer is. If they already have a parent profile, drop the name fields entirely and greet them: "Signed in as Mariah Gillespie" with a way to switch accounts. Name fields stay only for someone with no parent profile yet.

**Widen the "is this your athlete?" list.**
Instead of exact-name-only, offer:
- exact matches first,
- then close matches on the same last name (nickname/short forms like Leo/Leon, one-or-two-character differences),
- then, collapsed under "Show my other athletes", the rest of the claimer's own athletes.

All of these are the claimer's own records, so nothing about anyone else's account is disclosed. Copy becomes "Is this someone you already have on Gradus?" with each athlete's name and a "Yes, same athlete" action, plus the existing "keep them separate" path.

**Wait for the session before rendering.**
Show a brief loading state until the sign-in state is known, so the form never flashes for signed-out visitors.

## Technical detail

- `src/lib/guardian.functions.ts`
  - New `getGuardianClaimContext` (auth middleware): returns `{ hasParentProfile, parentName }` for the signed-in user.
  - `getGuardianClaimMergeOptions`: replace the exact-name filter with a ranked match — `exact` (full name equal), `close` (same normalized last name and first-name prefix match or Levenshtein <= 2), `other` (everything else on the account). Return `{ athleteId, name, rank }`, sorted.
- `src/routes/g.$token.tsx`
  - Consume the new context query; hide the first/last name inputs when `hasParentProfile` and show the signed-in identity line instead.
  - Render exact + close options up front, the rest behind a "Show my other athletes" toggle.
  - Render a loading state while `signedIn === null`.
- No schema changes. `mergeGuardianClaim` is unchanged — it already validates the target athlete belongs to the caller.
