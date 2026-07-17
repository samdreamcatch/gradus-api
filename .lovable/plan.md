## Current state (coach@test.dev / Tami Taylor)

- `organization_id`: `07cfbb37-…` (linked to a club)
- `entitlement`: `club_covered`
- `subscription_tier`: `coach`, `subscription_status`: `trialing`
- `stripe_customer_id`: `cus_Utm2OYgv0nHvSc` (already has a Stripe subscription record on file)

## Change

Single `UPDATE` on `coach_profiles` for this user:

- `organization_id` → `NULL` (unlink from the club)
- `entitlement` → `'paid'` (individual coach on their existing trialing subscription)

Leave `subscription_tier`, `subscription_status`, and `stripe_customer_id` as-is, so `PlanSection` renders the paid/trialing branch with the "Manage subscription" button — exactly the "individual coach on trial" state you want to inspect.

No schema change. Data-only, via the insert tool.

## Reverting later

If you want them back on the club afterwards, we set `organization_id` back to `07cfbb37-e558-4f08-85f2-9304b5d3aad0` and `entitlement` back to `club_covered`.