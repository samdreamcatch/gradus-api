# Paywall visual re-order

Rearrange `/coach/paywall` to match the reference flow. No component, copy, pricing, or business-logic changes — only the order, stacking, and grouping of the blocks already on the page.

## New top-to-bottom order

```text
  ✦  icon
  Choose your plan / Activate your workspace
  subhead
  [Current plan pill]           (unchanged, entitled coaches only)

  ┌──────────────────────────────┐
  │ COACH                        │  full width
  │ $30 / mo  (or Free · FOUNDING)│
  │ ✓ features                   │
  │ [ Continue ]                 │
  └──────────────────────────────┘

  ┌──────────────────────────────┐
  │ COACH PRO      RECOMMENDED   │  full width, emphasized
  │ $70 / mo                     │
  │ [ Monthly | Yearly −15% ]    │  interval toggle moves inside Pro card
  │ promo / founding trial chip  │
  │ ✓ features                   │
  │ [ Start N months free ]      │
  │ Cancel anytime               │
  └──────────────────────────────┘

  ───── OR GET PRO THROUGH ─────

  🏢  Joining through a club?  → search + code
  🏷️  Have a promo code?       Apply

  [No changes — return to workspace]  (entitled only)
  Unlink from current club            (when applicable)
  Sign out
```

## Changes

- Tier cards go from a 2-column grid to a single full-width stacked column, Coach first, Coach Pro second.
- Coach Pro card gets a `RECOMMENDED` chip in its header row (same chip styling already used for `FOUNDING` / `CURRENT`; when the card is the current plan, `CURRENT` wins).
- The Monthly/Yearly toggle moves from above the cards to inside the Coach Pro card, directly under the price. It keeps the same markup and the same disabled-when-club-code state.
- Coach Pro card gains a "Cancel anytime" line under its CTA (moved out of the page subhead).
- Club block and promo-code block move below the tier cards, under a new `OR GET PRO THROUGH` centered divider (rendered with existing divider tokens, not a new component).
- The "Individual plans unavailable while a club code is entered" note moves with the cards.
- Footer order stays: return-to-workspace → unlink club → sign out.

## Technical notes

- Single file: `src/routes/_authenticated/coach.paywall.tsx`. JSX is reordered inside the returned tree; all state, handlers, `PRICE_MAP`, `FEATURES`, and the tier `.map()` body remain as-is apart from layout classes and the toggle's new position.
- Because the toggle now renders inside the Pro card, it renders only for the `coach_pro` iteration of the map; `interval` state stays at page level so the Coach card price stays in sync.
- Grid `grid-cols-2` → `flex flex-col gap-3 w-full`; per-card responsive text sizes can drop their cramped `sm:` split since cards are now full width.
- `src/routes/dev.paywall-preview.tsx` is updated to mirror the same arrangement so the preview route stays representative.
