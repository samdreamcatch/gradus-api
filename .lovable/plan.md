## Goal

Replace the split "Coaches / Parents / Athletes" list views with a single unified **Users** table at `/admin/users` — spreadsheet-style with filter, sort, per-column search, and inline admin actions.

## New route

`src/routes/_authenticated/admin.users.tsx` — table view. The existing summary chips (Total, New/7d, Onboarded, With athletes, Active plans, etc.) move above the table as stat cards. `admin.list.$kind.tsx` stays temporarily; retired once parity is confirmed.

## Columns

| Column | Source | Sort | Filter |
|---|---|---|---|
| Name | coach/parent/athlete profile | ✓ | text |
| Email | auth.users.email | ✓ | text |
| User type | derived: coach / internal admin / org admin / youth athlete / adult athlete / parent | ✓ | multi-select |
| Last login | auth.users.last_sign_in_at | ✓ | — |
| Plan | coach_profiles → `coach_effective_tier()` (coach / coach_pro / club / founding); blank for non-coaches | ✓ | multi-select |
| Internal admin | `user_roles.role = 'admin'` | ✓ | y/n |
| Test user | profile.is_test | ✓ | y/n |
| Org admin | `user_roles.role = 'org_admin'` (or `organizations.admin_user_id`) | ✓ | y/n |
| Organization | joined org name — **editable** combobox | — | multi-select |
| Promo codes | chips — **editable** popover (add/remove) | — | text |
| Actions | Reset password, Soft delete | — | — |

Row click → existing `/admin/users/$userId`.

## Interactions

- **Header**: global search (name/email), user-type multi-select, plan multi-select, admin/test/org-admin y/n toggles, "has org" filter. Sort by column click. Cursor pagination (100/page).
- **Reset password**: confirm dialog → server fn (a) sends the standard Supabase recovery email to the user AND (b) returns a recovery link the admin can copy to clipboard. Toast confirms both.
- **Soft delete**: destructive AlertDialog (admin types the user's email to confirm) → server fn sets `deleted_at = now()` on the profile row, disables the auth user via `supabase.auth.admin.updateUserById(id, { ban_duration: '876000h' })` (100 years) so they can no longer sign in, and revokes sessions. Data is preserved for audit. A "Restore" action appears on soft-deleted rows. Requires a new `deleted_at timestamptz` column on `coach_profiles`, `parent_profiles`, and `athletes` (migration).
- **Edit promo codes**: chip-input popover; server fn validates against `promo_codes` and writes to a new `user_applied_promo_codes(user_id, promo_code_id, scope, applied_by, created_at)` table with unique `(user_id, promo_code_id, scope)`. `scope` is `'next_checkout'` (default) or `'active_now'`. When admin picks **"Apply to current subscription now"**: server fn attaches the corresponding Stripe coupon to the user's active subscription in the current env via `stripe.subscriptions.update({ discounts: [{ coupon }] })`, using `createStripeClient(env)` from `@/lib/stripe.server`. When admin picks **"Apply to next checkout"** (default): code is stashed on profile and picked up by the existing coach-checkout flow. Removing a chip: for `active_now`, removes the coupon from the live subscription; for `next_checkout`, just clears the stash.
- **Tag org**: reuses `OrgSearchCombobox`; server fn sets/clears `coach_profiles.organization_id`. Setting an org promotes the coach to the club tier via existing `coach_effective_tier` path; unsetting triggers the existing "leaves club" logic (stashes `WELCOME_BACK`).

## Server work (`src/lib/admin.functions.ts`)

All new fns use `requireSupabaseAuth` + `has_role(_, 'admin')` gate, then `supabaseAdmin` inside handler:

- `listAllUsers({ search, types, plans, isAdmin, isTest, isOrgAdmin, hasOrg, includeDeleted, sort, dir, cursor })` — joins `auth.users`, `user_roles`, `coach_profiles`, `parent_profiles`, `athletes`, orgs.
- `adminResetUserPassword({ userId })` — returns `{ recoveryLink }` and enqueues the email.
- `adminSoftDeleteUser({ userId, confirmEmail })` / `adminRestoreUser({ userId })`.
- `adminSetUserOrg({ userId, organizationId | null })`.
- `adminApplyPromoCode({ userId, code, scope: 'next_checkout' | 'active_now', env })`.
- `adminRemovePromoCode({ userId, promoCodeId, env })`.

## Migration

- Add `deleted_at timestamptz null` to `coach_profiles`, `parent_profiles`, `athletes`.
- Create `public.user_applied_promo_codes` with GRANTs + RLS (admin-only via `has_role`).
- Update existing RLS on profile tables to filter `deleted_at IS NULL` for non-admin reads.

## Design

Sticky-header table on `bg-card` with `border-divider`, ruled rows, mirroring `admin.promo-codes.tsx`. `Chip` toggles + `Input` + `Popover` multi-selects for filters. Destructive actions in `AlertDialog`. No hover styles — press feedback per the design memory.

## Out of scope

- Impersonation (already at `/admin/impersonation`).
- Bulk row actions.
- CSV export (easy add later — flag if you want it in v1).