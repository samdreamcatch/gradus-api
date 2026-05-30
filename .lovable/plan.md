# Pool Blue: new role

Pool Blue stops appearing on athlete metadata. Instead it lives in two narrow, principled places — exactly as standard secondary-accent practice prescribes: ambient atmosphere + reserved data role.

## 1. Revert the metadata changes (back to neutral ink)

Three spots currently colored pool go back to neutral text tokens:

- **`src/routes/_authenticated/coach.plans.tsx`** — PlanRow move count returns to `text-text-secondary`; StatusPill "Template" tag and "Active athlete" badge return to their previous neutral styles (`bg-elevated text-text-tertiary` / muted wash).
- **`src/components/coach/move-field.tsx`** — "From your voice" reveal button returns to `text-accent-ink/70`, and the quote display returns to `bg-elevated/70 text-text-secondary`.

Net effect: identity & metadata read as quiet ink-on-paper again. Tennis stays the only saturated color in content.

## 2. Pool Blue takes the top half of the page wash

In `src/styles.css`, the body background currently uses two radial gradients, both tinted with `--accent` (tennis). Change the **top-right** gradient to use `--pen-pool` instead, while the bottom-left stays tennis. Result: a subtle two-tone atmosphere — cool blue light pouring in from the top, warm tennis glow rising from below. Always present, never demanding attention, never on a content element.

Saturation strategy: keep the gradient at the same low percentages (34% / 28% color-mix) so pool reads as ambient atmosphere, not as a branded panel. This matches your "mostly washes, rare ink" directive — at the page level, it's literally just a wash.

Both modes get the same swap; the dark-mode pool variant is already brightened in tokens so it'll render correctly.

## 3. Reserve Pool Blue as the data-viz secondary (token only, no UI yet)

There are no real charts in the app yet (only a placeholder bar-chart slot on the plan detail page). So this step is **token plumbing only**:

- Keep the `--pen-pool` / `--pen-pool-wash` / `--pen-pool-ink` tokens already defined.
- Keep the semantic `--color-secondary-accent` / `-wash` / `-ink` aliases pointing at pool, so when charts arrive they have a ready home: tennis = primary metric, pool = secondary/comparison metric, with washes for fills and ink for axis labels & lines.
- No component changes here — this is forward-compatible scaffolding.

## What you'll see in the preview

- The page background gets a faint cool tint in the upper right and a warm tennis glow in the lower left.
- Athlete metadata, move counts, template badges, and the voice reveal all return to neutral.
- Tennis is the only saturated color on any content element.

## Technical notes

- Only `src/styles.css`, `src/routes/_authenticated/coach.plans.tsx`, and `src/components/coach/move-field.tsx` are touched.
- Background change is a one-line swap of `var(--accent)` → `var(--pen-pool)` on the first radial gradient in the `body` rule.
- Semantic tokens stay in place for future chart work — no removal.
- AAA contrast is unaffected because pool ink is no longer applied to text surfaces.
