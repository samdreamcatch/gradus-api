# Get invited parents connected: claim link + code, managed from admin

Right now every athlete whose parent hasn't joined already has a personal claim link
(`gradus.training/g/<token>`) that creates the parent's account **and** connects them to
their athlete in one step. There are 18 real athletes in that state today. The only place
that link can be re-sent from is the athlete's own settings screen — you have no way to
see, copy, or resend it, and there is no code a parent can type if the link is lost.

Sending these parents to `gradus.training` cold is exactly the wrong path: they'd create a
fresh, unconnected account.

## What gets built

### 1. A typeable claim code

Each pending athlete gets a short 8-character code (same style as coach/parent invite
codes: `K7QM2XPD`) alongside the existing long link token. Backfilled for all current
pending athletes, generated automatically for new ones.

A parent can then either:
- click `gradus.training/g/<token>` (personal link, as today), or
- go to `gradus.training/i/K7QM2XPD` — or enter the code on the invite entry screen —
  and land on the same claim page.

Both paths end in the same place: create account (or sign in if they already have one) →
athlete is linked.

### 2. Admin controls (Users list)

On an athlete row whose parent hasn't joined yet, a "Parent invite" section with:
- guardian email on file, plus invited/claimed status and date
- **Copy link** and **Copy code**
- **Resend invite email**
- **Change guardian email** (re-sends to the new address)
- Regenerate — issues a fresh link + code and invalidates the old one

Rows that are already claimed show "Parent joined" with the parent's name instead.

### 3. A pending-parents view

A filter/section in admin listing exactly the athletes with an outstanding parent invite —
athlete name, guardian email, when invited, link, code — so you can work the follow-up
list in one pass and copy what you need.

## Technical notes

- Migration: add `guardian_claim_code text unique` to `public.athletes`, backfill for rows
  with a `guardian_claim_token` and no parent, keep it null once claimed. No new table, so
  existing grants/RLS on `athletes` continue to apply; the code is only ever read through
  server functions.
- `resolveInviteCode` (`src/lib/invite-resolve.functions.ts`) gains a `guardian` kind that
  looks the code up and returns the claim token; `/i/$code` routes that kind to
  `/g/<token>`. Existing rate limiting covers enumeration.
- Code generation reuses the existing lookalike-free alphabet helper pattern from
  `coach-invite.functions.ts`.
- `resendGuardianInvite` in `src/lib/guardian.functions.ts` gains admin authorization
  (currently athlete-or-their-coach only) and returns the link + code; a new admin-only
  server function lists pending guardian invites and one regenerates the token/code.
- Admin UI changes live in the existing users list / user detail components — no new
  design components, existing Sheet + copy-button patterns only.
