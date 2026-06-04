Lighten the dark-mode card surface so text on cards reads more comfortably, while keeping the popover/elevated tiers visually above cards.

## Change

In `src/styles.css`, dark-mode block only:

- `--card`: `oklch(0.195 0.012 245)` → `oklch(0.255 0.012 245)` (Option B, clear lift)
- `--elevated`: `oklch(0.235 0.012 245)` → `oklch(0.285 0.012 245)` (stay one step above card)
- `--popover`: `oklch(0.245 0.012 245)` → `oklch(0.30 0.012 245)` (stay above elevated)
- `--divider`: `oklch(0.34 0.012 245)` → `oklch(0.36 0.012 245)` (small nudge so borders still read on the lifted card)

Light mode untouched. No component changes.

## Why this is safe

- Body text token (`--text-primary` at L 0.945) on the new card (L 0.255) is ~13.5:1 — well above AAA.
- Tertiary text (L 0.84) on card is ~9.5:1 — still AAA.
- Hierarchy is preserved: background (0.18) &lt; card (0.255) &lt; elevated (0.285) &lt; popover (0.30).