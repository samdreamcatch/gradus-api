# Clean up duplicate DiMuro records + admin user editing

## 1. Remove the stray duplicate accounts

Two leftover records from the Addie DiMuro signup confusion get hard-deleted, along with their logins:

- Self-managed athlete `066e1147…` — no parent, no plans, duplicate of the real Addie.
- Coach "Addisyn DiMuro" `67d6a357…` — an accidental coach signup.

The real athlete record (`3e60f91b…`, parent-managed by Christine, holds both plans) is untouched.

## 2. Admin can edit user fields

On the admin user detail page, an "Edit" control opens a sheet where an admin can correct:

- First and last name
- Birthdate (athletes)
- Login email
- Parent / guardian email (athletes)
- Username (athletes)

Each field validates before saving, and the page refreshes with the new values.

## 3. Admin can move an athlete between self-managed and parent-managed

For athletes only: an admin can attach the athlete to an existing parent, or detach them back to self-managed. This is the fix for a duplicate/mis-linked athlete without touching the database directly.

**No role conversion.** Admins cannot change a user's type (athlete ↔ coach ↔ parent) from the panel — that stays out of the product.

## 4. Admin can delete a user

A guarded delete on the user detail page removes the profile rows and the login, with a typed confirmation naming the user. Audited like the existing admin actions.

## Technical notes

- `src/lib/admin.functions.ts`: add `adminUpdateUserFields` (zod-validated per-role field set), `adminSetAthleteParent`, and `adminDeleteUserHard`. All admin-gated via the existing `has_role` check; deletion follows the `deleteTestUser` blueprint (lines 61–127) but without the test-flag restriction.
- `src/routes/_authenticated/admin.users.$userId.tsx`: edit Sheet with existing form primitives, a parent-link picker for athletes, and an AlertDialog for delete (destructive confirms only).
- The two stray records are removed with a one-off data operation, not a schema migration.
- No RLS/grant changes; all writes go through admin-verified server functions using the service-role client.
