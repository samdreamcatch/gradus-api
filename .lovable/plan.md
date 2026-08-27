# Show the guardian invite link and code on every athlete profile

On Lauren Francis' admin profile the **Parent / guardian email** and **Guardian
status** rows appear, but there's no claim link or code to send her guardian —
because the invite controls on that page are hidden whenever the athlete is
self-managed. Lauren signed herself up, so the block never renders.

The Parent invites list was just fixed the same way; the user-detail page still
has the old condition.

## What to change

1. **Render the invite controls for self-managed athletes too.** Any athlete
   whose parent hasn't claimed them gets the "Parent invite" block on their
   admin profile: typeable code, personal claim link, copy buttons, send-invite
   field, and regenerate.

2. **Keep the existing safeguards.** The block still hides once a parent has
   joined (claimed or linked), and it still shows the "goes to the athlete's own
   inbox" warning when the guardian email matches the athlete's login email.

3. **Make the connection promise explicit.** Add a one-line note above the
   controls: opening the link or typing the code at gradus.training creates the
   guardian's account and connects them to this athlete automatically.

## Technical notes

- `src/routes/_authenticated/admin.users.$userId.tsx` around line 287: drop
  `!data.athlete.self_managed` from the render condition, keeping
  `!parent_id && !guardian_claimed_at`.
- `src/components/admin/guardian-invite-controls.tsx`: add the short helper line
  under the "Parent invite" eyebrow.
- No schema change, no server-function change — `adminGetGuardianInvite`
  already mints a token/code on demand for any unclaimed athlete.
