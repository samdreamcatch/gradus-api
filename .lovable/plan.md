## What changes on `/admin/promo-codes`

- Remove the **Label** column from the table.
- Make each row's **code cell** the click target (keeps existing inline toggles for Duration/Plans/Card/%/Stripe/Active clickable without conflict).
- Clicking a code opens a **right-side Sheet** (existing overlay doctrine) showing:
  - Code (mono), label as title, notes wrapped underneath.
  - Duration + plans + card-required + % off, read-only summary.
  - Stripe status pill for both test and live environments.
  - **Users who applied this code** — grouped by Coaches / Parents / Athletes, each with name + email, linking to the existing `/admin/users/$userId` detail page.

## New server function

`listPromoCodeUsers({ code })` in `src/lib/promo-codes.functions.ts`:
- Admin-gated (reuses `assertAdmin` pattern).
- Unions two sources:
  1. Profile stash — rows from `coach_profiles`, `parent_profiles`, `athletes` where `promo_code = code`.
  2. Admin-applied — rows from `user_applied_promo_codes` where `code = code`, joined back to whichever profile owns that `user_id`.
- Returns `{ users: { userId, kind, name, email, source: "stash" | "admin_next" | "admin_active", environment?: "sandbox" | "live" }[] }`.

## Frontend

- New `PromoCodeDetailSheet` component inside `admin.promo-codes.tsx`.
- Fetched lazily via `useQuery(["admin-promo-code-users", code], enabled: !!openCode)`.
- Existing `getPromoCodeStats` counts stay visible on the row (P/C/A columns) — no change.

## Out of scope

- No schema changes.
- Inline edit controls in the table stay where they are; the sheet is read-only for now.
