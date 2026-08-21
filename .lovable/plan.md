# Security finding: promo_codes Stripe IDs — already mitigated

## What the database actually shows

I checked the live permissions on `promo_codes` before drawing any conclusion:

- Table-level privileges for `authenticated` are `awdDxtm` — insert, update, delete, but **no read** (`r`).
- Read access is granted **column by column** to `authenticated`, on exactly: `code`, `label`, `active`, `notes`, `created_at`, `updated_at`, `percent_off`, `duration`, `duration_in_months`, `card_required`, `applies_to_plans`.
- The four Stripe columns — `stripe_coupon_id_sandbox`, `stripe_promo_id_sandbox`, `stripe_coupon_id_live`, `stripe_promo_id_live` — have **no grant to any client role**. A signed-in user selecting them gets a permission error.
- `anon` has no privileges on the table at all.

So the exposure the scanner describes does not exist. The scanner reads the row-level policy text ("allows reading active rows") and assumes all columns are reachable; it does not evaluate column-level grants, which are what actually gate this table.

Admin screens are unaffected — they read through the service-role client.

## Proposed action

1. Leave the schema as is. No migration, no view, no policy change — any of those would only re-do what column grants already enforce, and dropping the row policy would break `validatePromoCode`.
2. Mark the finding as ignored with the reason above so it stops resurfacing.
3. Update the security memory to record that `promo_codes` is protected by column-level grants rather than a column-scoped policy, so future scans and future agents don't re-flag it or "fix" it by re-granting table-wide SELECT (which is what caused the earlier WILSON outage).

## Verification

Re-confirm after the memory update that the Stripe columns still have no client grant and that promo validation still works for a signed-in coach.
