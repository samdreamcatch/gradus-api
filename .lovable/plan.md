## Goal

Founding Coach = the **Coach** plan, free for life. They see everything a paid Coach sees, including an "Upgrade to Coach Pro" affordance — shown today in a disabled "Coming soon" state. When Coach Pro ships, it's priced and structured identically for everyone; the `FOUNDING_COACH` grandfathering only covers Coach.

## Context

- Coach Pro is currently a "Coming soon" tile in `src/routes/_authenticated/coach.paywall.tsx` (button disabled, `SOON` badge). No Coach Pro price is purchasable yet.
- Nothing in the app gates features by `subscriptionTier` today, so Coach vs Coach Pro is a label on the subscription. Founding Coach maps to the Coach label.
- Paid Coach block in `src/routes/_authenticated/coach.settings.tsx` (~lines 538–587) has no "Upgrade to Coach Pro" row. Founding Coach block (~lines 510–523) only shows `Join a club`.
- One shared upgrade component in both blocks keeps them in sync when Coach Pro ships.

## Changes

### 1. Shared `UpgradeToProRow` component

New file `src/components/coach/upgrade-to-pro-row.tsx` wrapping `SettingsButtonRow`:

- Icon `Sparkles`, tone `accent`, label `Upgrade to Coach Pro`.
- Always visible. While Coach Pro is not purchasable, the row is disabled with description `"Coming soon — advanced scheduling, multi-coach visibility, up to 75 athletes."` and a `SOON` chip on the right.
- Once Coach Pro is live (new flag `isCoachProAvailable()` in `src/lib/paywall-flag.ts`, reading `VITE_COACH_PRO_ENABLED`), the row enables, the chip drops, description becomes `"$70/mo or $59.50/mo billed yearly — save 15%."`, and clicking navigates to `/coach/paywall?tier=coach_pro`.
- Behavior identical regardless of caller.

### 2. Founding Coach block in `coach.settings.tsx`

Update the `profile.promoCode === "FOUNDING_COACH"` branch (~lines 510–523):

- `PlanSummaryCard` label: `Founding Coach`.
- Description keeps the current "Thank you for being here early." copy.
- Status pill: `COACH · FREE` (single accent pill) — this is the Coach plan, on the house.
- `SettingsList` under the card, in order: `UpgradeToProRow`, then `joinClubRow`.

### 3. Paid Coach block in `coach.settings.tsx`

In the `entitlement === "paid" && subscriptionTier === "coach"` case (~lines 538–587), insert `UpgradeToProRow` above `Manage subscription`. `coach_pro` subscribers don't see it. Same component as Founding Coaches.

### 4. Paywall route accepts a preselected tier

In `src/routes/_authenticated/coach.paywall.tsx`:

- Extend `validateSearch` to also parse `tier` (via `fallback` from `@tanstack/zod-adapter`, no closed enum).
- When `tier === "coach_pro"` and Coach Pro is available, auto-open Coach Pro checkout.
- Pricing/purchase flow unchanged — everyone pays the same for Coach Pro, Founding Coaches included.

### 5. No pricing/DB changes

- `FOUNDING_COACH` promo unchanged (100% off, applied at signup, covers the Coach plan).
- When a Founding Coach upgrades to Coach Pro, they check out at the standard Coach Pro price via existing `coach-checkout.functions.ts`; the webhook flips their `subscription_tier` to `coach_pro`. The promo does not carry over.

## Technical notes

- Files touched: `src/routes/_authenticated/coach.settings.tsx`, `src/routes/_authenticated/coach.paywall.tsx`, `src/lib/paywall-flag.ts`, new `src/components/coach/upgrade-to-pro-row.tsx`.
- No database migration.
- No changes to `coach-checkout.functions.ts` — it already accepts `coach_pro_monthly` / `coach_pro_yearly`.
