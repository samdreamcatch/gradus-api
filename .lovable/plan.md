## Goal
Differentiate the "+ Wallace" / "+N coaches" pill on the roster card from the neutral lesson-time pills so it reads as a separate category of information — without introducing new tokens or breaking design-system rules.

## Approach
Keep the pill shape and size consistent with siblings (still `rounded-pill`, same padding, same `text-[11px]`), but re-skin it using the **pool pen** secondary-accent tokens already reserved for "athlete identity + data/metadata about people." Coaches on the athlete are exactly that: people-metadata, so pool is the semantically correct pen (and it's the athlete-side pen, matching the left rail color that already sits on the card).

## Change (single file: `src/components/coach/roster-card.tsx`)
Replace the neutral chip classes on the `+ coaches` span:

- `bg-elevated` → `bg-secondary-accent-wash`
- `border-divider` → `border-secondary-accent/30` (subtle, not loud)
- `text-text-secondary` → `text-secondary-accent-ink`
- Add a tiny leading `Users` icon (lucide, `size-3`, `-ml-0.5 mr-0.5`, `aria-hidden`) so the shape reads as "people" at a glance before the text.
- Keep font weight `font-medium` (do not bump to bold — restraint is the system).

Lesson-time pills stay untouched (neutral `bg-elevated` + divider border), so the contrast between "schedule" (neutral) and "shared coaches" (pool-wash + icon) is immediate.

## Not doing
- No new colors, no new utility, no size/shape change.
- No change to badge copy or logic.
- No hover states (press-only doctrine).
- Not touching the "Also coached by" list inside the sheet.
