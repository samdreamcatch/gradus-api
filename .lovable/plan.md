
## Goal

Coaches are the only paying role. Split them into two paths at the very start of onboarding:

- **Club coach** — enters an org invite code, gets linked to the organization, skips payment.
- **Individual coach** — optionally enters a promo code for a discount, checks out via Stripe at the end of onboarding, gets access on webhook confirmation.

Both paths converge into the existing name/sports/levels/hours/invite/review flow.

## New onboarding step order

```text
1. Path choice       ← NEW (before profile)
2. Profile (name + sports)
3. Levels
4. Hours
5. Parent invite (existing)
6. Review → Finish
   ├─ club path:      → /coach   (entitled: club-covered)
   └─ individual:     → Stripe Checkout → webhook → /coach
```

Step 1 is a single screen with two large `Card`s (Individual / Club) using existing pen/paper design tokens. Selecting Club expands an org-code input (same UX as parent invite code). Selecting Individual expands the existing `PromoCodeField` (optional).

If the coach arrives via a link that already includes `?org=CODE` or `?promo=CODE`, prefill and preselect the matching path.

## Data model (one migration)

**`organizations`** — created only by Gradus admins.
- `name`, `slug`, `active`, `notes`

**`organization_invite_codes`** — one active code per org, rotatable.
- `organization_id`, `code` (8-char, uppercase, unique), `active`, `created_at`

**`coach_profiles`** — add:
- `organization_id uuid null references organizations`
- `entitlement text` — one of `pending`, `club_covered`, `paid`, `promo_free`
- `stripe_customer_id text null`, `stripe_subscription_id text null`, `subscription_status text null`, `current_period_end timestamptz null`

RLS: coaches read their own org row; only admins write orgs and codes. `has_role(uid,'admin')` already exists. Reuse the `record_invite_lookup_attempt` rate limiter for org-code lookups.

## Server functions (new `src/lib/coach-org.functions.ts`)

- `getOrganizationByInviteCode({ code })` — public-ish (auth required), returns `{ organizationId, name }` for display before claim.
- `claimOrganizationInviteCode({ code })` — sets `coach_profiles.organization_id` + `entitlement='club_covered'`. Idempotent.
- Admin CRUD: `listOrganizations`, `createOrganization`, `updateOrganization`, `rotateOrganizationInviteCode`, `getOrganizationStats` — mirror the promo-code admin pattern in `promo-codes.functions.ts`.

## Payments (Lovable built-in Stripe)

Deferred to a follow-up turn — requires `enable_stripe_payments`, product creation, and a webhook. This plan wires the UI + entitlement state so payment can slot in without reshuffling onboarding. Until Stripe is enabled:

- Individual path's "Continue to payment" button shows a `Coming soon` state, but still sets `entitlement='pending'` and completes onboarding into a **locked** app shell (a full-page paywall on `/coach` that reads entitlement).
- Promo code is stashed via existing `savePendingPromoCode` and applied post-checkout.

Once Stripe is enabled in the next turn:
- Add `startCoachCheckout` server fn → creates Stripe Checkout Session with `client_reference_id = coach_profiles.id` and any promo discount as a Stripe coupon.
- Add `/api/public/stripe/webhook` route: on `checkout.session.completed` / `customer.subscription.updated`, set `entitlement`, `stripe_*`, `subscription_status`.
- Paywall on `/coach` clears when `entitlement in ('paid','promo_free','club_covered')`.

## UI additions

- `src/routes/_authenticated/coach.onboarding.tsx` — insert new first step `path`, gate `handleContinue` on org-code claim, thread `entitlement` through review.
- `src/components/onboarding/coach-path-choice.tsx` — new component: two cards, expandable code inputs, uses `PromoCodeField` + a new sibling `OrgCodeField` (copy pattern from parent invite lookup).
- `src/routes/_authenticated/admin.organizations.tsx` — new admin page (mirror `admin.promo-codes.tsx`) for org CRUD + code rotation + signup stats.
- Add "Organizations" link to the admin nav.
- Coach paywall component shown on `/coach` when entitlement is `pending`.

## Design system usage

All new UI uses existing tokens only: `bg-card`, `bg-elevated`, `text-accent-ink`, `pen-highlight`, `shadow-card`, `Button`, `Input`, `Label`, `Badge`, `Collapsible`. No hardcoded colors. Two-card path choice mirrors the visual weight of the existing role picker at `/`.

## Out of scope (this plan)

- Club-admin self-serve dashboard (org creation stays admin-only).
- Seat-based / per-coach club billing on Stripe (assumption: club pays Gradus out-of-band; `club_covered` is just a flag).
- Migrating existing coaches to the new entitlement model — they'll be backfilled `paid` (or `club_covered` if manually assigned) in the same migration.

## Ready to build?

Confirm and I'll:
1. Run the migration.
2. Implement org server fns + admin page + onboarding path step + paywall (no Stripe yet).
3. In a follow-up, call `enable_stripe_payments`, add checkout + webhook, and wire the paywall to unlock.
