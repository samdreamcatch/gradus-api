# Delete-account dialog: fixed confirmation phrase + minor athlete choice

Two changes to the self-service deletion flow.

## 1. Confirm by typing "DELETE ACCOUNT"

- The dialog asks the user to type `DELETE ACCOUNT` (case-insensitive, trimmed) instead of their email address. The Delete button stays disabled until it matches.
- Admin-side deletion keeps its email confirmation — an admin deleting someone else's account should have to name that account.

## 2. What happens to a minor athlete when their only guardian leaves

Today the parent branch handles three cases. The last one is what changes:

- Athlete has another guardian → transfers to them (unchanged).
- Athlete has no sign-in of their own and no other guardian → the profile and its history are erased (unchanged).
- **Athlete is under 18, signs in themselves, and has no other guardian** → the athlete keeps their account, and the departing guardian chooses what happens to the oversight link.

When the deleting parent has at least one athlete in that third group, the dialog shows a per-athlete choice before they can confirm:

- **Keep sending copies to my email** (default) — the athlete's `guardian_email` stays on file, so lesson recaps and communication copies keep going to that address even though the guardian's Gradus account is gone.
- **Delete this athlete's account too** — the athlete's sign-in and profile are erased with the guardian's, same as the no-account case.

There is no option to leave a minor with no adult on file: either an adult stays reachable, or the minor's account goes too.

Adult athletes (18+) with their own sign-in are not offered this — their guardian link is simply removed.

## Technical details

- `src/components/settings/account-security-section.tsx`
  - Replace the email `Label`/`Input` with a text input labelled "Type DELETE ACCOUNT to confirm".
  - Before opening, fetch the parent's affected minors via a new server function (`getDeletionImpact`) returning `{ id, firstName }` for athletes with `parent_id = me`, `user_id NOT NULL`, birthdate under 18, and no other guardian.
  - Render one radio group (existing `RadioGroup`/`Label` primitives) per affected athlete with the three options above; default `keep`.
  - Update the description paragraph to match the real behaviour (transfer / erase / minor choice).
- `src/lib/account-deletion.functions.ts`
  - `deleteMyAccount` input becomes `{ confirmPhrase: string, minorChoices: Array<{ athleteId: string, action: "keep" | "clear" | "delete" }> }`; validate the phrase equals `DELETE ACCOUNT`.
  - Add `getDeletionImpact` (authenticated, read-only) for the dialog.
- `src/lib/account-deletion.server.ts`
  - `deleteAccountForUser` takes the choices map. In the parent branch, for a self-signing minor with no successor: `keep` → detach `parent_id` only and leave `guardian_email`; `clear` → detach and null `guardian_email`; `delete` → `purgeAthlete` plus removing that athlete's auth user.
  - Unknown/missing choice defaults to `keep` so a server-side call can never silently strip oversight.
- Verify with typecheck and lint.
