# Ungate invoicing for all coach plans

Invoicing is currently limited to Coach Pro and Club. This makes it available to every coach, including basic Coach and Founding Coach.

## What changes for coaches

- The Billing tab on the roster works for everyone — no upgrade card, no locked state.
- The Billing section inside an athlete's detail sheet works for everyone: set a rate, generate an invoice, share it, mark paid.

## Technical changes

- `src/lib/invoicing.functions.ts`: replace `requireProCoach` with a plain `requireCoach` that resolves the coach profile and returns `coachId` (drop the `tier === "coach"` throw). Every existing call site keeps working; auth + roster-ownership checks stay exactly as they are.
- `src/components/coach/billing-tab.tsx`: remove the `locked` prop and the upgrade/lock branch; always fetch invoices.
- `src/routes/_authenticated/coach.roster.tsx`: stop passing `locked` to `BillingTab`.
- `src/components/coach/athlete-billing-section.tsx`: remove any tier gating if present there.

No database, RLS, or Stripe changes — the gate was app-side only.
