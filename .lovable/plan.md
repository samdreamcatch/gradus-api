## Goal

Every invite link "just works" — signed-in recipients get auto-connected; signed-out recipients get the code carried into signup so they're connected the moment they finish onboarding. No copy-pasting codes.

## Current state (what already works vs. what's missing)

| Link | Recipient | Signed-in behavior today | Signed-out behavior today |
|---|---|---|---|
| `/signup/coach?invite=CODE` (parent→coach) | Coach | Auto-claims and routes to `/coach` ✅ | Stores code, claims after signup ✅ |
| `/signup/parent?invite=CODE` (coach→parent) | Parent | **Ignored — no auto-claim** ❌ | **Ignored — code not prefilled** ❌ |
| Coach invite → Adult athlete | Adult athlete | **No path exists** ❌ | **No path exists** ❌ |
| `/signup/athlete?code=CODE` (parent→under-18 athlete) | Under-18 athlete | Already flows through parent-invite claim ✅ | Same ✅ |

The parent↔athlete invite flow already behaves correctly, so the plan targets only the coach↔parent/adult-athlete pairs.

## Behavior rules (from your answers)

1. **Coach's invite link lands on a small role picker** ("Are you a parent or an adult athlete?"). One tap, then flow continues with the code attached.
2. **Wrong-role click** → friendly "this invite isn't for your account" screen with sign-out option. No silent second-account creation.
3. **Already-connected / already-used** → toast "Already connected" and route to their dashboard. No confirmation screen.

## Changes

### New route: `/i/$code` — universal invite entry

A single short link every "Share invite" button uses. It:

1. Looks up the code server-side, resolves whether it's a `coach_invite_codes` row (parent→coach), a `parent_invite_codes` row (coach→parent), or an `athlete_invite_codes` row (parent→athlete, unchanged path).
2. Reads current session:
   - **Signed out** → routes to the right signup entry with the code attached:
     - coach-invite code → role picker (parent vs adult athlete) → `/signup/parent?invite=CODE` or `/signup/athlete/adult?invite=CODE`
     - parent-invite code → `/signup/coach?invite=CODE`
     - athlete-invite code → existing `/signup/athlete?code=CODE`
   - **Signed in, right role** → calls the appropriate claim server fn, toasts success (or "Already connected" if idempotent), navigates to the user's dashboard.
   - **Signed in, wrong role** → renders the "this invite isn't for your account" screen with a "Sign out and continue" button that signs out and re-enters the same `/i/$code` URL.

All existing `ShareInviteButton` URLs are updated to point at `/i/CODE` so shared links get the new behavior; old `/signup/*?invite=` URLs keep working as fallbacks.

### `/signup/parent` — honor `invite=CODE`

- Extend `validateSearch` to accept `invite` (8-char coach code).
- If present: prefill the "Coach invite code" input (read-only chip) and pass it through to the existing `/signup/parent/athletes` step, which already claims it. No new server fn needed — the existing parent-signup claim path handles it.
- If a signed-in parent lands here with `invite`, immediately call the existing parent-signup coach-claim path (same one `/signup/parent/athletes` uses) and route to `/parent`.

### `/signup/athlete/adult` — accept `invite=CODE`

- Extend `validateSearch` to accept `invite`.
- If present: prefill the coach-code field (already exists in the adult onboarding step) so `createSelfManagedAthlete` (which already accepts a coach code) links the coach on signup.
- If a signed-in adult athlete lands here with `invite`, call the existing adult-athlete coach-claim server fn (`linkAthleteToCoach` in `adult-athlete-signup.functions.ts`) and route to `/athlete`.

### Update share targets

- `src/components/parent/invite-coach-card.tsx`, `invite-coach-banner.tsx`, `onboarding/invite-card.tsx`, `parent/athlete-invite-card.tsx`, and the under-18 "invite my parent" button in `signup.athlete.tsx` — swap the shared URL from `/signup/*?invite=CODE` to `/i/CODE`. The role picker + auto-claim then handles the rest.

## Technical notes

- One tiny new server fn `resolveInviteCode({ code })` returning `{ kind: 'coach'|'parent'|'athlete', valid, expired, used }` — reuses the existing rate-limited `record_invite_lookup_attempt` RPC. All actual claiming reuses existing server fns (`claimParentInvite`, the parent-signup coach-claim path, `linkAthleteToCoach`, `claimAthleteInvite`).
- Wrong-role detection is a client-side compare of `kind` vs. current user's role (via existing `has_role` / role context).
- "Already connected" is detected by the claim server fns returning idempotently, or by a pre-check `coach_athletes` / `athlete_primary_coaches` row lookup — surfaced as a toast, not an error.
- No DB schema changes. No new tables. No new columns.

## Out of scope

- Athlete↔parent flow (already works).
- Email / SMS delivery of invites.
- Expiring or rotating existing codes on click.
- Multi-code batching.
