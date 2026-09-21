# Billing-field findings: already protected, close them out

Both findings are policy-level observations. The database already blocks these writes with active triggers, which the scanner does not inspect.

## What I verified in the live database

- `coach_profiles` has two enabled triggers on insert/update: `protect_billing_columns_on_coach_profiles` and `protect_coach_profile_columns`. Together they reject or silently revert changes to entitlement, subscription tier/status, period end, founding coach, founding pro trial, free access until, Stripe customer/subscription IDs, subscription environment, promo code, organization, and org-admin flag — unless the caller is trusted server code.
- `parent_profiles` has the matching pair: `protect_billing_columns_on_parent_profiles` and `protect_parent_profile_columns`, covering subscription status, period end, Stripe IDs, subscription environment, promo code, and team plan seats.

So a parent or coach updating their own row from the app can change only their own name and preferences; a billing-field change raises a permission error or is reverted.

## Proposed action

1. Mark both findings (`parent_profiles_self_upgrade_subscription`, `coach_profiles_self_upgrade_entitlement`) as reviewed/ignored, with the trigger names as the justification, so they stop recurring.
2. No schema change, no policy change, no application code change.

## Optional hardening (only if you want it)

Add an explicit end-to-end check: sign in as a test coach and a test parent in the preview and attempt a direct billing-field update, confirming both are rejected. This proves the protection from the client side rather than from the schema alone.
