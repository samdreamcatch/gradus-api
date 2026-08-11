# Fix: promo code WILSON throws an error

## What's actually wrong

Signed-in users have no read access to the promo code table at all.

The earlier security fix was meant to hide the Stripe ID columns from regular users. Instead of removing just those columns, it removed the `authenticated` role's read permission on the whole table. So the moment a coach types `WILSON` and the app checks whether the code is valid, the database refuses the read and the app shows "Something went wrong."

This is confirmed, not a guess:

- The `authenticated` role's permissions on `promo_codes` are `awdDxtm` — insert, update, delete, but no read (`r`).
- There are no column-level read grants to fall back on either.
- The row-level policy "Authenticated can read active promo codes" still exists and is correct. It never gets a chance to run, because the table-level permission is checked first.

The failure is at `src/lib/promo-codes.functions.ts` line 32, in `validatePromoCode`, which reads the table as the signed-in user.

## A second problem found along the way

The `anon` role — unauthenticated visitors — still has full read access to `promo_codes`, including both Stripe ID columns. The security fix locked out the wrong role: it blocked legitimate signed-in users and left the public role untouched. So the original exposure was never actually closed.

## The fix

One migration, two parts:

**1. Restore read access for signed-in users, safe columns only.**
Grant `SELECT` to `authenticated` on exactly the non-sensitive columns: `code`, `label`, `active`, `percent_off`, `duration`, `duration_in_months`, `card_required`, `applies_to_plans`, `notes`, `created_at`. The four Stripe ID columns stay unreadable. The existing row policy continues to restrict users to `active = true` rows.

**2. Close the anon exposure.**
Revoke all privileges on `promo_codes` from `anon`. No policy grants anon anything, and no code path reads promo codes as anon — every reader is either a signed-in user or an admin path.

Admin screens are unaffected: they read through the service-role client, which has its own grant and bypasses row policies.

## Verification

After the migration:

- Re-check the permission bits on the table to confirm `authenticated` has read on the safe columns and none on the Stripe columns, and that `anon` has nothing.
- Confirm a direct read of a Stripe ID column as `authenticated` is still denied.
- Enter `WILSON` in the app as a signed-in coach and confirm it validates and shows the discount instead of erroring.

## Note on scope

This restores the behavior that existed before the security fix, minus the actual leak. It does not change how promo codes are applied, how discounts flow into Stripe, or anything about the paywall — only who is allowed to read which columns.
