# Why Lauren Francis' invite is missing from Parent invites

The email was actually sent. On Aug 22 at 00:27 UTC a `guardian-invite` to
`jenntodd13@yahoo.com` was queued and logged as **sent**, followed by a `welcome`
email at 00:30 — both delivered without errors.

It doesn't appear in the admin **Parent invites** list because that list only
includes athletes marked as parent-managed. Lauren Francis signed herself up as a
self-managed athlete and entered `jenntodd13@yahoo.com` as her guardian email — the
same address her own athlete login uses. So the invite went to that inbox, but the
athlete row is filtered out of the pending list.

This is not a one-off: of 19 athletes with an unclaimed guardian email, 10 are
self-managed (hidden from the list today) and 5 have a guardian email identical to
the athlete's own login address.

## What to change

1. **Show self-managed athletes in Parent invites.** Drop the parent-managed-only
   filter so any athlete with a guardian email on file and no claimed parent shows
   up, with a small "self-managed" marker on those rows so it's clear the athlete
   runs their own account.

2. **Flag same-inbox invites.** When the guardian email matches the athlete's own
   login email, show a "goes to the athlete's own inbox" warning on the row and in
   the user-detail invite controls, so you can correct the address before resending
   instead of re-sending to the wrong person.

3. **Add a delivery hint.** On each pending row, show the last invite send result
   from the email log (sent / failed / not yet sent, with the date), so "did it
   actually go out?" is answerable without leaving the page.

## Technical notes

- `listPendingGuardianInvites` in `src/lib/guardian-admin.functions.ts`: remove
  `.eq("self_managed", false)`, keep the `parent_id is null` /
  `guardian_claimed_at is null` conditions, and return `selfManaged`, the athlete's
  own auth email (via admin lookup on `athletes.user_id`), and a `sameInbox`
  boolean.
- Same function: join the latest `email_send_log` row per athlete's guardian email
  for templates `guardian-invite` / `athlete-invite`, deduplicated by `message_id`,
  and return `lastSend { status, at }`.
- `src/routes/_authenticated/admin.parent-invites.tsx`: render the new markers and
  the last-send column; no change to the existing copy/resend/regenerate actions.
- `src/components/admin/guardian-invite-controls.tsx`: show the same-inbox warning
  above the resend control.
- No schema change.
