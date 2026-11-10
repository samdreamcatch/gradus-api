# Club admin: what's left before a real paying club can use it end to end

A real club admin's journey, and where each step stands today:

```text
Buy seats -> Club + admin created -> Invite coaches -> Coaches get Pro access
 -> Import schedule -> Invite families -> Publish policies/library -> Monitor -> Renew / change seats
```

## Blockers (a real club cannot get through without these)

1. **Staff setup screen for a sold club.** Sales reps close deals on custom contracts, and Gradus staff set up the club (that's intended). What's missing is one staff screen to do it in a single pass: club details, sports, seat count, contract dates and file, then send the first admin their invite. Today these steps are split up, and parts of them happen directly in the backend.
2. **Seats don't control paid access.** A coach gets club-level access just by being attached to a club, not by holding a seat, and nothing checks contract end dates. Tie access to holding a seat in a club with an active contract; define what happens when the contract lapses (for example, coaches fall back to their own plan, like Family's read-only on lapse).
3. **People controls unfinished.** Admins can't yet change roles, resend or cancel invites, or move a seat from one coach to another. Needed on day one.
4. **Schedule import stops before the end.** Upload, coach matching and review work, but it can't match students to athletes who already exist, can't create the lessons, and doesn't hand off to the invite step. Only CSV is accepted.
5. **Emails never tested for real.** Coach invites, family lesson invites and library reminders are wired but have never been sent (by your request). Reminders still need you to pick an email template. Email verification is also still off.

## Should have before launch

6. **Contract visibility for the admin:** seat count, contract dates, and a "contact your Gradus rep for more seats" action in Settings. No checkout.
7. **Admin onboarding:** a first-run checklist on Home (invite coaches, upload schedule, publish policies).
8. **End-to-end check with fresh accounts:** a brand-new admin, coach and parent, on desktop and phone, rather than the seeded Test Club.
9. **Remove demo leftovers** (test logo/colors, "QA Warm up", seeded notifications) or keep them only in Test Club.

## Can wait

- Coaching development/effort numbers (need a reliable measure).
- People credentials and expiry tracking.
- Safety features: messaging checks, cases, season campaigns.
- Storefront (no sales/payout storage exists).
- Photo/PDF/Excel schedule uploads.

## Proposed order

2 first (paid access must follow the contract), then 1, 3, 4, 5, then 6 to 9.

## Technical notes

- Today `coach_effective_tier` returns `club` whenever `coach_profiles.organization_id` is set; it ignores `org_seats` and `organizations.contract_ends_on`.
- Contract and seat fields are edited only via staff-only `updateClubContract`.
- Lesson invites reuse `sendGuardianInvite`; nothing has been sent.
