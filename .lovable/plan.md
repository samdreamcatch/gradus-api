# Clean up duplicate Addie records + admin field editing

## 1. Remove the two stray Addie accounts

Confirmed in the database:

- Keep: athlete `3e60f91b…` — username `addie`, birthdate 2007-10-08, linked to Christine, holds both plans.
- Remove: athlete `066e1147…` — same name/birthdate, self-managed, no parent, no plans, own login (created Jul 20). It is linked to the same coach as the real Addie, which is how the wrong record became reachable.
- Remove: coach profile `67d6a357…` "Addisyn DiMuro" — a coach account created by mistake under her name.

For each: unlink from the coach roster, delete the profile/athlete row and any dependent rows, then delete the login so the email is freed. The real Addie's record, plans, coach link and parent link are untouched.

## 2. Admin editing of user fields

On the admin user detail page, add an "Edit" affordance to the identity block so an admin can correct data in place:

- First name, last name
- Birthdate (athletes) — set or clear
- Email (the login email) — changing it updates the account's sign-in email
- Guardian email (athletes) — set or clear
- Username (athletes) — set or clear

Clearing is allowed for the optional fields (birthdate, guardian email, username). Name and email are required and cannot be blanked.

### User type

Changing a user's type is not a simple field edit — a coach, parent and athlete each have different records and connections behind them, so converting one into another would strand plans, rosters and invites. Instead the admin gets the changes that are actually safe:

- Athlete: toggle between self-managed and parent-managed (detach from parent / attach to a parent by email).
- Mark/unmark as a test user (already exists) and soft-delete/restore (already exists).

If you want true role conversion (e.g. this athlete account should become a coach), say so and I'll scope it separately — it needs a migration-of-data step, not a dropdown.

## Technical notes

- Data cleanup runs as a one-off data operation, not a migration: delete `coach_athletes` rows, then `athletes`/`coach_profiles` rows, then `auth.admin.deleteUser` for each stray login — the same sequence `deleteTestUser` already uses, without the test-user guard (these are real but erroneous records).
- New server fn `adminUpdateUserFields` in `src/lib/admin.functions.ts`: admin-gated, zod-validated (name lengths, ISO date, email format), writes to `coach_profiles`/`parent_profiles`/`athletes` depending on the user's kind, and calls `supabaseAdmin.auth.admin.updateUserById` for email changes. Plus `adminSetAthleteParent` for the parent attach/detach.
- New server fn `adminDeleteUserHard` (admin-gated, requires typing the account email to confirm) so future stray accounts can be removed from the panel instead of by hand.
- UI in `src/routes/_authenticated/admin.users.$userId.tsx` only: existing Sheet + Input + Button primitives, no new components.
- No schema, RLS or grant changes.
