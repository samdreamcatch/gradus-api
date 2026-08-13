# Let parent-managed athletes add a coach

## Why it's missing today

`athlete6@test.dev` (Jamie Gilmore, born 2018) has `self_managed = false` and a linked parent. Every coach-connect path — the Settings section, the invite-code generator, and the code-entry link — is gated on `self_managed = true`, so the whole "Coaches" group is hidden for athletes whose account was created by a parent.

## What changes

Any athlete signed into their own account can add a coach, whether or not a parent manages the account. The requirement becomes "a guardian is reachable," not "the athlete is self-managed":

- Adult athlete (18+): no guardian needed, as today.
- Minor with a `guardian_email` on file: allowed, as today.
- Minor managed by a parent account: allowed — the linked parent's email is the guardian on file.
- Minor with neither: still blocked, with the existing "add a parent or guardian email above first" note.

The parent keeps full visibility: coaches the athlete links still appear in the parent's Connected coaches list with the unlink control.

## Screens

`/athlete/settings` shows the Coaches group for any athlete with their own login. Same components as today — linked-coach list plus the Share / Enter code sheet. No new UI.

## Technical notes

- `listAdultAthleteCoaches` (`src/lib/adult-athlete-signup.functions.ts`): stop returning early on `!self_managed`. Return `selfManaged: true`-equivalent (rename the flag to `canConnectCoach`) computed as `18+ OR guardian_email OR parent_id IS NOT NULL`, and set `needsGuardianEmail` only when a minor has neither guardian email nor parent.
- Same gate replaces the `!self_managed` throws in `getOrCreateAdultAthleteInviteCode`/link paths in `adult-athlete-invite.functions.ts` and in `adult-athlete-signup.functions.ts` (preview + link-by-code).
- RLS: `public.is_self_managed_athlete(uuid)` backs the INSERT policies on `coach_athletes`, `coach_athlete_sports`, and `adult_athlete_invite_codes`. Migration adds a sibling `public.athlete_can_self_connect(uuid)` (security definer) that matches on `user_id = auth.uid()` regardless of `self_managed`, and updates those INSERT policies to use it. `is_self_managed_athlete` stays in place for other callers.
- Trigger `enforce_adult_self_managed` is only touched if it blocks these inserts; the athlete's `self_managed` flag itself is not changed, so the parent relationship stays intact.
- `athlete.settings.tsx`: swap the `isSelfManaged` condition for the new `canConnectCoach` flag; keep the guardian-note branch.
