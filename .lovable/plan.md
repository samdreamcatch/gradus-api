# Design System Codification — Batch 1

Lock in four patterns already used consistently across the app. No visual changes — this only extracts current usage into reusable primitives and tokens so future work stays on the rails.

## 1. Eyebrow labels — 3-tier system

Confirmed roles from screenshots + code sweep:
- **9px** — dense grids/rings (week schedule day cells, practice-ring labels, attention chips)
- **10px** — component-level labels (plan-card, sport-goal-card, athlete-detail-sheet, move-field, bottom-nav, voice-fab)
- **11px** — page-section headers (public share, feedback FAB, room-view/room-list headers, settings section markers, sports filter chips, beta banner)

**Deliverable:**
- Add three text tokens in `src/styles.css` under `@theme`: `--text-nano: 9px`, `--text-micro: 10px`, `--text-caption: 11px` (each with `line-height` and `letter-spacing: 0.05em`, uppercase applied by the component).
- New component `src/components/ui/eyebrow.tsx` — `<Eyebrow size="nano|micro|caption" tone?="secondary|tertiary|accent-ink|attention-ink">`. Renders `<p>` with `font-bold uppercase tracking-wide` + the size token; tone maps to existing color tokens.
- Codemod pass: replace hand-rolled `text-[9px]/[10px]/[11px] font-bold uppercase tracking-*` at the confirmed call sites with `<Eyebrow>`. Preserve exact color per site.

## 2. Focus rings — 2 modes

- **`focus-input`** — diluted: `focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30`. Used on textareas/inputs (feedback-fab, room-view, move-sheet).
- **`focus-surface`** — solid: `focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-0`. Used on discrete tap targets (bottom-nav tile, roster-card).

**Deliverable:**
- Two `@utility` blocks in `src/styles.css`: `focus-input` and `focus-surface` (both no offset, matching current behavior).
- Codemod pass: replace inline ring utilities at the confirmed sites.
- Add a short note to the design doc: "Never use `ring-offset-*` — flush rings only."

## 3. Card padding — 3 tiers

- **`p-4`** = row-style list cards (roster-card, plan-card in list)
- **`p-5`** = content-section cards + dialog interior (motivation-card, invite-card, admin section cards, `<Dialog>` primitive)
- **`p-6`** = empty states + hero/feature cards

**Deliverable:**
- Extend the existing `Card` primitive with a `variant` prop: `row | section | hero` → applies `p-4 | p-5 | p-6` and matches existing `rounded-2xl border border-divider bg-card shadow-sm` defaults where applicable.
- Codemod: convert existing hand-rolled `article.rounded-2xl.border.border-divider.bg-card.p-{4,5,6}` at the confirmed sites to `<Card variant=…>`. Leave one-off cards with divergent styling (custom bg, gradients, ring accents) alone.

## 4. Simulated-surface tokens (pure whites)

Each is an intentional simulation of an external context — not a design-system surface. Lock them behind named tokens so nobody confuses them with `bg-card`.

- `--surface-athlete-screen` = `#FFFFFF` (celebration-preview: coach previewing athlete's phone)
- `--surface-email-client` = `#FFFFFF` (admin.emails email preview)
- `--surface-code-block` = `#0F172A` fg `#E2E8F0` (admin.errors stack trace)

**Deliverable:**
- Add the three tokens in `src/styles.css` under `:root` + register in `@theme inline` as `--color-surface-athlete-screen`, `--color-surface-email-client`, `--color-surface-code-block` (+ `--color-surface-code-block-foreground`).
- Replace the current `bg-white` / `bg-[#0F172A]` at the three known sites with the semantic token classes.
- Add a comment in `styles.css` above the block: "Surface simulations — reserved for previewing an external context inside our UI. Never use for our own surfaces."

## Files touched

- `src/styles.css` — tokens + utilities
- `src/components/ui/eyebrow.tsx` (new)
- `src/components/ui/card.tsx` — add `variant` prop
- Call sites for each pattern (roughly 45 files across coach/athlete/parent/admin/messages/plans)
- `docs/features.md` or the design doc — short "how to pick" section for each primitive

## Out of scope (explicitly)

- No color, spacing, or typography changes beyond wrapping current values.
- No dark-mode retuning.
- No behavior changes on focus (same ring width, same offset = 0).
- Other drift categories (button variants, dialog patterns, etc.) come in later batches.
