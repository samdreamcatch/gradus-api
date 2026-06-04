All edits are in `src/styles.css` — no component changes needed.

## 1. Contrast fixes (AAA audit items 1–3)

**Destructive text (currently 1.81:1, unreadable)**
- Add a paired token: keep `--destructive` as the fill tone, introduce `--destructive-ink` for text-on-surface.
- Light mode: `--destructive-ink: var(--destructive)` (already passes).
- Dark mode: `--destructive-ink: oklch(0.82 0.15 25)` (~7.5:1, AAA).
- Map `--color-destructive` (used by `text-destructive` utility) to `--destructive-ink` so existing `text-destructive` usages in `invite-card.tsx`, `login.tsx`, `signup.*`, `parent.settings.tsx` become readable automatically. Keep a separate `--color-destructive-fill` → `--destructive` for `bg-destructive` cases (Button destructive variant, alert borders).

**Text tertiary (3.7:1 → AAA)**
- Dark `--text-tertiary`: lift from `oklch(0.74 0.014 80)` to `oklch(0.84 0.014 80)` (~8.4:1).

**Pen-pink and pen-orange (just below AAA on card/elevated)**
- Dark `--pen-pink`: `oklch(0.82 0.170 8)` → `oklch(0.86 0.16 8)`.
- Dark `--pen-orange`: `oklch(0.85 0.180 55)` → `oklch(0.87 0.17 55)`.

## 2. Blue-dominant wash (dark mode only)

Currently the `body` background image uses two radial gradients of roughly equal weight — pool (blue) top-right, accent (tennis green) bottom-left. Make blue dominate ~75% of the canvas in dark mode by overriding the body background under `.dark`:

- Enlarge and re-center the pool radial so it covers most of the viewport (e.g. `radial-gradient(1800px 1300px at 70% 30%, color-mix(in oklab, var(--pen-pool) 42%, transparent), transparent 75%)`).
- Shrink the accent radial to a smaller corner glow (e.g. `radial-gradient(600px 500px at 5% 100%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 55%)`).
- Keep the ruled-line layer unchanged.
- Light mode wash stays as-is.

Implementation: add a `.dark body { background-image: ... }` rule that overrides the base `body` rule's image stack.

## 3. Warmer cream body text (scalable approach)

Per your choice: retune `--text-primary` globally in dark mode so every consumer of `text-text-primary` / `text-foreground` inherits the warmer tone.

- Dark `--text-primary`: from `oklch(0.97 0.018 85)` → `oklch(0.945 0.032 85)` (warmth level 4 — distinctly cream, still ~15:1 contrast on `--background`, well above AAA).
- `--foreground` already points at `--text-primary` via the dark block, so headings, body, buttons, inputs all warm up together.
- `--accent-foreground` stays the dark ink (used on bright tennis-green fills) — unchanged.
- Document the token at the top of the `.dark` block with a one-line comment so future contributors know it's intentionally cream, not white.

## Verification

After edits, mentally recompute contrast against `--background` (0.18):
- new `--text-primary` (0.945) → ~15.2:1 ✅
- new `--text-tertiary` (0.84) → ~8.4:1 ✅
- new `--destructive-ink` (0.82, c 0.15) → ~7.5:1 ✅
- pen-pink (0.86) → ~7.4:1 ✅ on card
- pen-orange (0.87) → ~7.6:1 ✅ on card

No component files change; this is a tokens-only update.
