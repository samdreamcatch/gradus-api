## Change

Rework the paywall tier-card button labels in `src/routes/_authenticated/coach.paywall.tsx` (~lines 699–716).

**New label rules:**

- Base label on both Coach and Coach Pro cards: **"Continue"** — replaces every current "Upgrade", "Upgrade to Coach Pro", and "Switch to Coach" variant. Applies whether or not the coach has an active subscription.
- Coach Pro card, when a valid promo with `durationInMonths > 0` is applied: keep **"Start N month(s) free"** (unchanged from `proCtaLabel`).
- Loading state: keep the existing spinner-style copy but simplify — use **"Starting…"** in all cases (drops the `hasActiveSub ? "Switching…" : "Starting…"` split, since the button itself no longer distinguishes new vs. switch).

**Result:**

```
No sub, no promo   → Coach: "Continue"   Coach Pro: "Continue"
No sub, promo      → Coach: "Continue"   Coach Pro: "Start 3 months free"
Active sub switch  → Coach: "Continue"   Coach Pro: "Continue"   (or promo label on Pro)
Current tier       → "Current plan" pill (unchanged)
Founding coach     → "Active" pill on Coach card (unchanged)
```

## Scope

- Single file: `src/routes/_authenticated/coach.paywall.tsx`.
- No changes to `handleTierAction`, entitlement logic, promo logic, or any other affordance (Manage billing button, current-plan banner, etc.).
- No DB, server-fn, or Stripe changes.

## Verification

- Sign in as an unentitled coach (or admin without a sub) — both cards read "Continue".
- Apply promo `WILSON` — Coach Pro card reads "Start 3 months free"; Coach card still reads "Continue".
- Sign in as a coach on Coach tier, open paywall with `?manage=true` — Coach card shows "Current plan" pill; Coach Pro card reads "Continue".
- Click a card — button shows "Starting…" while Stripe session is created.
