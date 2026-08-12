# Update yearly prices in Stripe to the 10% discount

The paywall copy already shows 10% off. This updates the actual amounts charged so checkout matches the displayed price.

## New yearly amounts

| Plan | Monthly | Yearly (was 15%) | Yearly (new 10%) |
| --- | --- | --- | --- |
| Coach | $30/mo | $306/yr | $324/yr ($27/mo equivalent) |
| Coach Pro | $70/mo | $714/yr | $756/yr ($63/mo equivalent) |

Monthly prices are unchanged.

## What happens

1. Update the yearly price for Coach (`coach_yearly`) to $324.00/year.
2. Update the yearly price for Coach Pro (`coach_pro_yearly`) to $756.00/year.

Both keep their existing IDs, so no code changes are needed — checkout, plan-change, and subscription-sync logic keep working as-is. The new amounts sync to the live environment on your next publish.

## Notes

- Existing yearly subscribers stay on the price they signed up at until they change plans; only new checkouts and plan changes use the new amounts.
- Prices are created in the test environment and promoted on publish — nothing is created directly in live.

## Technical details

- Uses `payments--create_price` with the existing IDs `coach_yearly` (32400 usd, interval `year`) and `coach_pro_yearly` (75600 usd, interval `year`), which replaces the amount behind the same lookup key.
- `quantity_min`/`quantity_max` set to 1 (flat-rate subscription, no seats).
- No edits to `src/routes/_authenticated/coach.paywall.tsx`, `src/lib/coach-checkout.functions.ts`, or `src/lib/coach-subscription-sync.server.ts`.
