# Lock down billing and role fields on profiles

Two related findings, same root cause: the "update own profile" policies on `coach_profiles` and `parent_profiles` have a `USING` clause only and no `WITH CHECK`, so any signed-in coach or parent can write **any** column on their own row from the browser — including `entitlement`, `subscription_tier`, `stripe_subscription_id`, `is_org_admin`, `founding_coach`, `promo_code`, and `is_test`. Confirmed against the live policies.

## Why a simple column lock isn't enough on its own

Several legitimate server functions currently write those protected columns through the **user's** client (not the privileged one), so a blunt lock would break real flows:

- founding-coach stamping and `completeOnboarding` (`entitlement`, `founding_coach`)
- joining / leaving a club (`organization_id`, `entitlement`, `last_synced_content_version`)
- accepting an org coach invite
- applying a promo code to your own profile (`promo_code`)

So the fix has two halves: guard the columns at the database, and move those trusted writes onto the privileged path where the caller is already verified.

## What changes

**1. Database guard (migration)**

Add a `BEFORE UPDATE` trigger on both tables that, for any update **not** made by the privileged service role, silently reverts protected columns to their previous values. Ordinary self-edits (first name, last name, `last_seen_at`, `onboarded_at`) keep working exactly as today.

Protected on `coach_profiles`: `entitlement`, `subscription_tier`, `subscription_status`, `subscription_environment`, `trial_ends_at`, `current_period_end`, `stripe_customer_id`, `stripe_subscription_id`, `is_org_admin`, `founding_coach`, `founding_pro_trial_used`, `organization_id`, `promo_code`, `is_test`, `last_synced_content_version`, `user_id`.

Protected on `parent_profiles`: `coach_id`, `promo_code`, `is_test`, `user_id`.

Also add the missing `WITH CHECK (auth.uid() = user_id)` to both update policies so a row can never be re-pointed at another user.

**2. Route trusted writes through the privileged client**

Each of these already verifies the caller server-side before writing; they switch from the user client to the admin client for the protected-column update only:

- `src/lib/coach-profile.functions.ts` — founding stamp inside `ensureProfile`, and `completeOnboarding`
- `src/lib/coach-org.functions.ts` — `joinOrganizationByCode`, the settings-side join flow, and `clearOrganizationLink`
- `src/lib/org-admin.functions.ts` — coach-side invite acceptance
- `src/lib/promo-codes.functions.ts` — `applyPromoCodeToMyProfile` (keeps the "only if currently null" condition)

Stripe webhook and subscription sync already use the privileged client and are unaffected.

**3. Verify**

Re-run the security scan, then check in the preview that coach onboarding completes, the settings plan section still reads correctly, and applying a promo code still works.

## Note

`is_org_admin` on `coach_profiles` is a role flag on a profile table. Authorization in the app reads `org_admins` (a separate table) via `has_org_admin()`, so this change closes the write hole without touching how permissions are decided.
