# Preview test checklist: profile column lockdown

The change locked billing, subscription, promo, org, and role columns on coach and
parent profiles so only trusted server code can write them. Everything below is a
path that still needs to write one of those columns. If each one still works, no
functionality was lost.

## 1. Coach onboarding + founding stamp

- Sign up a brand new coach (or use a dev coach with no onboarding done).
- Pick a sport, finish onboarding.
- Go to `/coach/settings`. Expect: plan shows the Founding Coach / complimentary
  state, not "pending". If it says pending, the founding stamp failed.

## 2. Promo code application

- As a coach without a promo, apply a code (e.g. `WILSON`) wherever the promo field
  appears in signup/settings.
- Expect: the code is accepted and the discount/label shows in settings after reload.
- Repeat once on a parent account if you have a parent promo path in use.

## 3. Club join

- As an individual coach in `/coach/settings`, join a club using an organization code.
- Expect: plan section flips to the club plan and the organization name appears.

## 4. Club leave

- From the same coach, leave the club.
- Expect: coach drops back to an individual state and is not locked out (the
  `WELCOME_BACK` path still applies).

## 5. Org coach invite acceptance

- Send an org coach invite from the Organization Admin portal and accept it on
  another coach account.
- Expect: that coach lands on the club plan.

## 6. Stripe checkout / upgrade

- From `/coach/paywall`, run a test upgrade to Coach Pro with a test card.
- Expect: after returning, settings shows Coach Pro and the subscription status is
  active/trialing. This confirms the webhook + verify-checkout sync still writes.

## 7. Normal profile edits still work

- In `/coach/settings`, change first/last name and save.
- In parent settings, change name and save.
- Expect: saves succeed (these columns are intentionally still writable).

## 8. Nothing else regressed

- Load `/coach/plans`, `/coach/roster`, and a plan detail page.
- Expect: no error screens; the profile read path is unchanged.

## If something fails

The likely cause is a write path that still uses the user-scoped client instead of
the privileged one. Report which step failed and I'll trace that specific function.
