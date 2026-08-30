# Confirm deletion by typing "DELETE ACCOUNT"

Replace the email-retype confirmation on the delete-account dialog with a fixed phrase, and correct the dialog copy now that orphaned minor athletes are erased rather than de-identified.

## What changes for the user

- The dialog asks them to type `DELETE ACCOUNT` (case-insensitive, trimmed) instead of their email address. The Delete button stays disabled until it matches.
- The third paragraph now reads accurately: athletes with another guardian transfer to them; an athlete with no other guardian and no sign-in of their own is deleted along with their plans, practice log and lesson history. An athlete who signs in themselves keeps their profile — only the guardian link is removed.

## Technical details

- `src/components/settings/account-security-section.tsx`: swap the email `Label`/`Input` for a text input labelled "Type DELETE ACCOUNT to confirm"; match against the constant phrase; drop the now-unused `currentEmail` prop usage for confirmation (keep it only if still shown elsewhere). Update the description paragraph.
- `src/lib/account-deletion.functions.ts`: rename the validated field to `confirmPhrase` and compare it to `DELETE ACCOUNT` instead of the JWT email. The account email is still read from claims for the audit hash.
- Admin-side `adminHardDeleteUser` keeps its email confirmation — an admin deleting someone else's account should have to name that account.
- Run typecheck and lint after the edit.
