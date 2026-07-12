## Goal

Extract the two pill patterns that repeat across the app into primitives that codify what the current app actually renders — no visual drift, no new tokens.

- **`<Chip>`** — interactive pill: tabs, filters, action pills, selectable options. Renders `<button>` when `onClick` is present, `<span>` otherwise. Accepts `selected` for the accent-filled state.
- **`<Tag>`** — static meta stamp: the `test` / `adult` / `custom` / `unsaved` style labels. Always a `<span>`, no interactive states.

Then sweep the eyebrow-batch out-of-scope wrappers plus any other pure-pattern sites the sweep uncovers.

## Primitives

Both live in `src/components/ui/`. Both forward `...rest` and merge `className` so call sites can still add layout classes like `ml-2`, `shrink-0`, `w-fit`.

### `<Chip>` API

```
size:      "nano" | "micro" | "caption" | "small"   // 9 / 10 / 11 / 12 px, matches Eyebrow
tone:      "default" | "accent" | "muted" | "destructive"
selected:  boolean                                    // accent fill + accent border
onClick?:  () => void                                 // presence → renders <button>
disabled?: boolean
as?:       "button" | "span" | "a"                    // override auto element
```

Shape is fixed to match the app: `rounded-pill border px-3 py-1 font-bold uppercase tracking-widest transition`. `selected` maps to `border-accent bg-accent text-accent-foreground` — exactly what admin.errors / admin.feedback / admin.list already do. Non-selected defaults to `border-divider bg-card text-text-primary hover:bg-elevated`, matching admin.index action pills.

Tones affect the resting fill and text color only; `selected` always overrides to accent. `destructive` uses `border-destructive/50 text-destructive` (from admin.users.$userId delete button).

### `<Tag>` API

```
size:  "nano" | "micro" | "caption" | "small"       // default "micro" (10 px)
tone:  "default" | "accent" | "muted"                // default "muted"
mono?: boolean                                       // font-mono (test/adult/custom stamps default true)
```

Shape fixed to: `inline-flex items-center rounded-pill border px-1.5 py-0.5 uppercase tracking-wider`. Default renders as the current `border-divider bg-elevated text-text-tertiary` mono stamp seen 8+ times across admin.

## In-scope call sites for the sweep

Only sites that are pure chip/pill patterns — the accent circle chip on plans line 532 and the `pen-highlight` wrappers stay out (still not a chip).

**Chip conversions** (interactive tab / filter / action pills):

- `admin.errors.tsx` line 50 — status tabs
- `admin.feedback.tsx` lines 54, 103 — status tabs + inline meta chip
- `admin.list.$kind.tsx` lines 112, 153, 192 — segmented tabs + filter row + pagination
- `admin.map.tsx` line 142 — filter tabs
- `admin.index.tsx` lines 74, 86, 93, 100, 106, 113, 132, 456 — coach-mode toggle, action pills, mini status filter
- `admin.users.$userId.tsx` lines 55, 81 — role toggle + destructive action
- `parent.settings.tsx` lines 704, 802 — settings toggles
- `parent/add-coach-by-code-card.tsx` lines 170, 200 — chip options
- `coach/sport-filter-chips.tsx` line 42 — sport filter (line 20's label is already an eyebrow-shaped chip; leave it a `<span>`-styled Chip with `selected={false}` disabled state, or keep as-is if it's not clickable)
- `coach/roster-settings-section.tsx` line 154 — destructive action pill
- `signup.parent.athletes.tsx` line 129 — chip label
- `global-error-boundary.tsx` line 44 — action pill

**Tag conversions** (static mono stamps):

- `admin.list.$kind.tsx` line 138 — `test` stamp
- `admin.index.tsx` lines 179, 427 — `test` stamps
- `admin.users.$userId.tsx` lines 43, 156 — `test user` / `adult` stamps
- `coach/roster-card.tsx` line 112 — count stamp (tabular-nums layout class preserved via `className`)

## Explicitly out of scope

To keep the churn safe:

- `coach/week-schedule-view.tsx` pen-colored pills (lines 276, 422, 439, 450, 460, 492) — they use pen-orange tokens and custom tracking; skipping now avoids inventing a "pen tone" API you rejected.
- `onboarding/sport-chip.tsx` and `onboarding/sport-multiselect.tsx` — already a well-scoped primitive, `text-sm` size sits outside the Eyebrow scale, and they use `border-2`. Leave them.
- The accent circle chip at `coach.plans.$planId.tsx` line 532 — that's a badge, not a pill.
- `pen-highlight` wrappers — not chips.
- `ui/switch.tsx`, `ui/carousel.tsx`, `ui/slider.tsx`, FABs — `rounded-pill` on those is layout, not a chip pattern.

These stay hand-rolled; if you later want a pen-tone or badge primitive we do them as their own batches.

## Verification per file

After each file's edits:
1. Read the file back and eyeball the diff.
2. `rg 'rounded-pill' <file>` — only the deliberately-skipped patterns (pen-colored, sport-chip, accent circle, switch/slider/carousel) should remain.
3. Visual check the tabs/filters still highlight correctly.

## Technical notes

- Files: `src/components/ui/chip.tsx`, `src/components/ui/tag.tsx`. Both use `cva` for variants, matching how `eyebrow.tsx` and other primitives are structured.
- `size` maps to the same `text-[9px|10px|11px|12px]` pairs Eyebrow uses. Weight is `font-bold` on Chip, `font-medium` on Tag (matches roster-card stamp) unless `mono` is set, which switches to `font-mono` and keeps `font-medium`.
- Chip auto-element: if `onClick` is passed and `as` is not, render `<button type="button">`; otherwise render `<span>`. This preserves the two dozen existing `<button className="rounded-pill …">` sites without asking each to pass `as="button"`.
- No changes to `src/styles.css`, no new tokens.

## What this codifies

The app's chip vocabulary — four sizes (matching Eyebrow), four tones, selected-vs-not, and a static mono tag — captured in two primitives. Anything exotic (pen fills, big sport chips, accent circle badges) stays out and gets its own primitive later if we want.
