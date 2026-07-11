# Add "Invite your coach" to adult-athlete settings

Give self-managed (adult) athletes the same "Invite your coach" surface parents have in settings: a shareable 8‑char code + link that a coach can consume to instantly roster the athlete. Youth-athlete flows are not touched.

## Behavior

- New **Coaches → Invite your coach** section on `/athlete/settings` (only when `selfManaged === true`).
- Uses the existing `InviteCoachCard` UI pattern but pointed at a new adult-athlete-owned code.
- Coach uses the code (via `/i/CODE` or on the `/signup/coach` invite step). Coach is linked to just this one adult athlete, mirroring `claimParentInvite` semantics but scoped to a single athlete.
- Fully idempotent — same code always resolves to the same athlete; re-claim is a no-op.

## Backend

New table `adult_athlete_invite_codes` (parallel to `parent_invite_codes`):

```text
id           uuid pk
athlete_id   uuid  fk athletes(id) on delete cascade, unique
code         text  unique, 8-char [A-Z2-9]
created_at   timestamptz default now()
```

Migration includes GRANTs (`authenticated`, `service_role`) + RLS: athletes can `select` their own row; coach lookups go through service-role server fns.

New server fns in a new file `src/lib/adult-athlete-invite.functions.ts` mirroring the parent ones:

- `getOrCreateAdultAthleteInviteCode` (auth, GET) — returns `{ code }` for the signed-in adult athlete; creates on first call. Rejects if not `self_managed`.
- `getAdultAthleteByInviteCode` (public POST, rate-limited via `record_invite_lookup_attempt`) — returns `{ athleteId, firstName, lastName }`. Used by `/signup/coach` preview.
- `claimAdultAthleteInvite` (auth POST, coach) — inserts `coach_athletes` (single athlete), `coach_athlete_sports` for every sport the coach offers, sets `athlete_primary_coaches` where missing. Idempotent.

Update `src/lib/invite-resolve.functions.ts`:
- Add a 4th lookup against `adult_athlete_invite_codes`.
- Extend `InviteKind` with `"adult-athlete"` and return that kind when matched.

## Routing

`src/routes/i.$code.tsx`:
- Signed-out `adult-athlete` code → `navigate('/signup/coach', { search: { invite: code } })` (same path parent codes use — the coach signup already handles a "parent-style" invite; we extend it to also recognize adult-athlete codes).
- Signed-in coach with `adult-athlete` code → call `claimAdultAthleteInvite` then go to `/coach`.
- Signed-in parent / adult athlete → `wrong-role` screen.

`/signup/coach` invite-preview step: when `getParentByInviteCode` fails, fall back to `getAdultAthleteByInviteCode` so the coach sees "You'll be linked to <Athlete Name>". Post-signup, if the pending invite is an adult-athlete code, call `claimAdultAthleteInvite` instead of `claimParentInvite`. (Detection: try parent lookup first, then adult-athlete.)

## UI

- Rename `src/components/parent/invite-coach-card.tsx`'s reusable shape into a shared component `src/components/invite/invite-coach-card.tsx` that takes an `audience: "parent" | "adult-athlete"` prop and picks the right server fn + copy ("Invite your coach" / "when your coach signs up they'll be linked to you, your sports, goals, and lesson times automatically"). Keep the existing `parent/invite-coach-card.tsx` as a thin wrapper so no parent code changes.
- In `src/routes/_authenticated/athlete.settings.tsx`, when `isSelfManaged`, add:

  ```tsx
  <SettingsGroup label="Coaches">
    <InviteCoachCard audience="adult-athlete" />
  </SettingsGroup>
  ```

  Placed directly above the existing "My coaches" group (or below — final placement in the file will match parent settings order).

## Out of scope

- No changes to youth athletes, `athlete_invite_codes`, parent invite flow copy, or coach onboarding UI beyond the fallback lookup in `/signup/coach`.
- No parent-facing components change behavior.
- No changes to `InviteCoachBanner` (parent-only).
