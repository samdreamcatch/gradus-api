## Goal

Let an individual coach join a club from **Settings → Plan** using a search + code flow, auto-handle their existing Stripe subscription, and capture the club name when the club isn't listed so BD can follow up.

## UI: "Join a club" in Plan section

In `src/routes/_authenticated/coach.settings.tsx`, inside `PlanSection`, add a new row below "Manage subscription" (and also in the `"pending"` "No plan yet" branch):

```
🏢  Join a club              ▸
    Your club covers your plan — enter their code to switch.
```

Tapping opens a **bottom Sheet** (per overlay doctrine) titled **"Join a club"** containing the existing two-step flow reused from onboarding:

1. `OrgSearchCombobox` — search / pick the club
2. `OrgCodeField` — enter and verify the 8-char code
3. Primary button **"Join {club name}"** (disabled until `orgVerified === true`)

If the coach currently has an active paid subscription, show a small note above the button:

> Your Coach {Monthly|Annual} plan will be canceled automatically when you join. {Annual only: You'll be refunded for the unused months.}

New file: `src/components/coach/join-club-sheet.tsx` — self-contained sheet reusing `OrgSearchCombobox`, `OrgCodeField`, `recordSilentClubLead`, and the new `joinOrganization` server fn below.

## Server: join + auto-cancel subscription

Add a new server function `joinOrganization` in `src/lib/coach-org.functions.ts` (or wrap `claimOrganizationInviteCode`). It runs, in order, inside a single handler:

1. Load coach profile: `entitlement`, `subscription_tier`, `subscription_status`, `stripe_customer_id`.
2. Resolve + validate the org code (same lookup as `claimOrganizationInviteCode`).
3. **If** the coach has an active/trialing Stripe subscription (`entitlement === "paid"` and `stripe_customer_id` present), look it up via `stripe.subscriptions.list({ customer, status: "all", limit: 10 })`, pick the newest `active`/`trialing`/`past_due` row, and:
   - **Monthly plan** (`price.recurring.interval === "month"`): `stripe.subscriptions.update(id, { cancel_at_period_end: true })`. No refund. Access continues through `current_period_end` but the club coverage takes over immediately in-app.
   - **Annual plan** (`interval === "year"`): compute unused fraction = `(period_end - now) / (period_end - period_start)`. Fetch the latest paid invoice for that sub (`stripe.invoices.list({ subscription, status: "paid", limit: 1 })`), take its `amount_paid`, and issue `stripe.refunds.create({ charge: invoice.charge, amount: round(amount_paid * unusedFraction) })`. Then `stripe.subscriptions.cancel(id)` immediately.
   - **Trialing** (either interval): `stripe.subscriptions.cancel(id)` — nothing to refund.
   - Wrap each Stripe call in try/catch and return `{ error: getStripeErrorMessage(err) }` — do not silently swallow.
4. Update `coach_profiles`: `organization_id`, `entitlement = "club_covered"`, `last_synced_content_version`, and clear `subscription_tier` + `subscription_status` (webhook will finish syncing when Stripe fires `customer.subscription.deleted` / `.updated`).
5. Return `{ organizationId, name, refundedCents?, canceledAtPeriodEnd? }` so the sheet can toast the right message:
   - Monthly: "Joined {name} — your Coach plan won't renew."
   - Annual: "Joined {name} — refunded ${amount} for the unused months."
   - No sub: "Joined {name}."

`claimOrganizationInviteCode` stays for the onboarding path (no existing subscription there).

## Lead capture when club isn't listed

Already partially in place: `recordSilentClubLead` writes to `organization_leads` from onboarding when the coach hits **"My club isn't listed"** in `OrgSearchCombobox`. Wire the same call into the new Join-a-Club sheet:

- Pass an `onNotListed={(typedQuery) => recordSilentClubLead({ data: { source: "not_listed", typedQuery } })}` handler to `OrgSearchCombobox`.
- After the lead is recorded, close the sheet and toast "Thanks — we'll reach out to {typedQuery}."

No schema change needed — `organization_leads` already stores `requested_org_name`, `requested_org_city`, `coach_user_id`, `coach_email`, and channel.

Ensure `OrgSearchCombobox`'s "not listed" affordance always passes the current search text so BD gets the club name the coach actually typed.

## Edge cases handled

- Coach with `entitlement === "pending"` (no sub yet): skip Stripe entirely, just link + set `club_covered`.
- Coach with `past_due` sub: still cancel (annual → refund the last successful paid invoice only; if none, skip refund).
- Coach whose sub is already `canceled` with `cancel_at_period_end`: no-op on Stripe, just link.
- Stripe call fails: return `{ error }`, do NOT link the org — coach stays on their paid plan and can retry.
- Idempotency: if they're already `club_covered` for this org, return success without touching Stripe.

## Files touched

- `src/lib/coach-org.functions.ts` — add `joinOrganization` server fn with the Stripe cancel/refund logic
- `src/components/coach/join-club-sheet.tsx` — new
- `src/routes/_authenticated/coach.settings.tsx` — add the row + sheet trigger inside `PlanSection` (both `"paid"` and `"pending"` branches)

No migrations, no new tables, no RLS changes.
