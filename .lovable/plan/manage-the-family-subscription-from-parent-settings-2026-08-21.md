# Manage the Family subscription from parent settings

Today the Family section in parent settings only manages guardians. The parent who actually
pays has no way to see their plan or change payment details, cancel, or view invoices — the
billing portal exists in the backend but nothing in settings opens it.

## What to add

A **Plan** section at the top of `/parent/settings`, matching the coach settings plan layout:

- **Payer (primary parent who bought the Family plan)** — a plan summary card showing
  "Family plan", the status (Active, Trialing, Past due, or Cancels on <date>), the renewal
  or end date, and a "Manage subscription" row that opens the Stripe billing portal in a new
  tab and returns to `/parent/settings`.
- **Covered co-guardian (non-payer)** — the same card, marked as covered by the primary
  parent, with no billing controls (they aren't the payer, so the portal isn't theirs).
- **No plan** — a card showing "Free" plus an "Upgrade to Family" row that routes to
  `/parent/family`, replacing the current implicit path through the guardians row.

Past-due status gets the destructive-tone tag and a short "update your payment method" line,
consistent with how the coach side surfaces dunning.

## Technical details

- `src/routes/_authenticated/parent.settings.tsx`: add a `PlanSection` above the existing
  Family group, styled with the same `PlanSummaryCard` pattern used in
  `coach.settings.tsx` (local copy of that presentational card — no new shared components,
  no new design tokens). Use existing `SettingsGroup` / `SettingsList` /
  `SettingsButtonRow` primitives.
- Data: `getFamilyPlanStatus` from `src/lib/parent-checkout.functions.ts` for status,
  `current_period_end`, and `hasBillingAccount`; `listFamilyGuardians` already returns
  `isPayer`, used to decide whether billing controls render.
- Portal: existing `createParentPortalSession` with
  `returnUrl = ${window.location.origin}/parent/settings`, environment from
  `getStripeEnvironment()`, opened with `window.open(url, "_blank")`; on an `error` result,
  show it via `toast.error`.
- Keep the guardians section as-is; it stops being the only entry point to the plan page.
- No schema, policy, or server-function changes.
