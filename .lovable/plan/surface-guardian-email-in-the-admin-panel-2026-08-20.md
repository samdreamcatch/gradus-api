# Surface guardian email in the admin panel

Today the parent/guardian email an athlete types at signup is stored on the athlete record, but the only place it's visible is the athlete's own `/athlete/settings` screen. Admins can't see it anywhere.

## 1. Admin user detail

On an athlete's admin profile, add a **Parent / guardian** block showing:

- The guardian email on file (or "None on file")
- Status: "Claimed" (guardian has joined and is linked), "Invited <date>", or "Not invited"
- The linked parent account name, when one exists

Shown only for athlete-type users; other user types are unaffected.

## 2. Admin users list

Add a **Guardian** column to the users spreadsheet:

- Athlete rows show the guardian email, or a short "—" when none
- A small status marker distinguishes claimed vs. invited-but-unclaimed
- Non-athlete rows leave the cell empty
- Column participates in the existing search/filter behavior so you can search by a guardian's email address

## Technical notes

- `getUserDetail` in `src/lib/admin.functions.ts`: extend the `athletes` select with `guardian_email, guardian_invited_at, guardian_claimed_at`, and return them on the athlete object; render in `src/routes/_authenticated/admin.users.$userId.tsx` next to the existing profile fields.
- `listAllUsers` in the same file: add the same three columns to the athletes select (already fetched there), map them onto `UserRow` as `guardianEmail` / `guardianClaimed` / `guardianInvitedAt`, and add the column to the table in `src/routes/_authenticated/admin.users.index.tsx`.
- No schema change and no new server function — `athletes.guardian_email` already exists and both reads run through the admin client.
