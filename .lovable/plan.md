## Doctrine

**One rule, two utilities, zero hover states.**

1. Interactive surfaces do not respond to hover. Hover is a desktop-only affordance that doesn't exist on the mobile target and won't survive the native rewrite. Removing it eliminates ~30 distinct `hover:*` variants currently scattered across the codebase.
2. Press feedback is the single signal that something is interactive: **scale down + surface darken**.
3. Toggles are quieter than buttons — the selection change is the primary feedback, press is a soft acknowledgement.

## The two utilities

Added to `src/styles.css` as `@utility` classes so they compose with Tailwind and show up everywhere as `className="press"` / `className="press-soft"`.

```css
/* Buttons, chips, cards, action pills — anything that commits an action. */
@utility press {
  transition: transform 120ms ease-out, filter 120ms ease-out;
  &:active { transform: scale(0.98); filter: brightness(0.95); }
}

/* Segmented toggles, day picker cells, tab-like controls. */
@utility press-soft {
  transition: transform 120ms ease-out;
  &:active { transform: scale(0.99); }
}
```

`filter: brightness(0.95)` works on any starting surface (paper, popover, accent fill) in both light and dark modes — no token gymnastics per variant. The 120ms curve is short enough to feel synchronous on touch, long enough to be visible on desktop.

## Migration

### 1. Add utilities + doctrine block

`src/styles.css` — add both `@utility` rules with a short doctrine comment. No token additions.

### 2. Strip `hover:*` and add `press` to primitives

- `src/components/ui/button.tsx` — remove `hover:*` from every variant (`default`, `destructive`, `outline`, `secondary`, `ghost`). Bake `press` into the base class. The `link` variant becomes permanently underlined (no hover reveal).
- `src/components/ui/chip.tsx` — remove `hover:*` from `default`, `muted`, `accent`, `destructive`. Add `press` to the base class when the chip is interactive (`onClick` or `href` present).
- `src/components/ui/filter-pill.tsx` — add `press` to the trigger className (currently has no press feedback at all).

### 3. Strip `hover:*` and add `press-soft` to toggles

- `src/routes/_authenticated/coach.roster.tsx` — the local `SegmentedToggle` component. Remove `hover:text-text-primary`, add `press-soft`.
- `src/components/plans/segmented-toggle.tsx` — same treatment.
- `src/components/coach/week-schedule-view.tsx` — the day cells (M/T/W…) get `press-soft`.

### 4. Strip `hover:*` and add `press` to composite surfaces

- `src/components/coach/roster-card.tsx`, `src/components/plans/plan-card.tsx` — strip `hover:*`, add `press`. Cards are actions.
- `src/components/coach/week-schedule-view.tsx` — the dashed "Create new lesson" CTA (already hidden on roster but still used elsewhere): swap `hover:border-accent hover:text-accent-ink` for `press`.
- `FirstPlanBanner` in `coach.roster.tsx` — strip `hover:bg-accent/15`, add `press`.

### 5. Out of scope for this pass

- **Sidebar** (`hover:bg-sidebar-accent`, `hover:text-sidebar-accent-foreground`) — shadcn-generated chrome, not a Gradus surface. Flag it; migrate in a follow-up if desired.
- **Text underline hovers** in prose/marketing (`hover:underline` outside the `link` button variant) — none currently exist in-app; nothing to do.
- Radix-provided hover states inside `DropdownMenu`, `Select` items, `AlertDialog` etc. — those are keyboard/pointer highlight states, not brand hover, and stay as-is.

## Verification

- `bunx tsgo --noEmit` clean.
- `rg 'hover:' src/components/ui src/routes/_authenticated src/components/coach src/components/plans` — expect near-zero matches (sidebar-scoped only).
- Manual: click a Button, a Chip, the FilterPill, a RosterCard, and a segmented toggle at 390px — buttons and cards get a firm press, toggles a soft press, nothing responds to hover.

## Memory

Save a Core memory line so this doctrine sticks across sessions:

> Interactive feedback: no `hover:*` on buttons/toggles/chips/cards. Use `press` (buttons/chips/cards, scale-.98 + brightness-.95) or `press-soft` (segmented toggles, scale-.99). Defined in `src/styles.css`.
