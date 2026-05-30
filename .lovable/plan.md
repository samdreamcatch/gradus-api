# Add Pool Blue as Secondary Accent

Right now everything inherits from `--accent` (Tennis), which is why the app reads monochromatic. We'll introduce **Pool Blue** as a second semantic token and apply it surgically to two domains: **athlete identity** and **data/metadata**. Tennis stays the coach action color (FAB, primary buttons, voice mic, "create"-style affordances).

## What "secondary" means

A second pen token that lives alongside `--accent`, used *only* in the places we name below. Same paper-stock feel, same pen system — just a second jelly color so the page has two voices instead of one.

## Where Pool Blue shows up

**1. Athlete identity** — anywhere we name or scope to an athlete:
- Athlete avatar tints (background wash + ink)
- Athlete name in plan cards (`coach.plans.tsx`) and the plan editor header (`coach.plans.$planId.tsx`)
- The athlete chip / "for {athlete}" label
- Athlete-scoped filter chips in the plans list when an athlete is selected
- The voice "matched athlete" highlight in the plan editor (currently a tennis glow → pool glow)

**2. Data & metadata** — non-action, informational surfaces:
- Move counts, durations, "X moves" subtitles on plan cards
- Timestamps ("Updated 2h ago", "Created…")
- Status/state badges that aren't actions: `Draft`, `Template`, sport tags
- Library move tags / category pills in the move sheet
- The "From your voice" source-quote pill in `move-field.tsx`

**Tennis stays for:** the `+` FAB, the mic FAB, primary CTAs (Save, Send to athlete), tab active states, the body background wash, the pen-highlight utility (since coach voice notes are a coach action).

## Technical plan

### 1. Add Pool tokens to `src/styles.css`

In `:root`, alongside the tennis pen block:
```css
--pen-pool: oklch(0.72 0.14 235);
--pen-pool-wash: oklch(0.97 0.025 235);
--pen-pool-ink: oklch(0.36 0.10 235);

--secondary-accent: var(--pen-pool);
--secondary-accent-wash: var(--pen-pool-wash);
--secondary-accent-ink: var(--pen-pool-ink);
```

Dark-mode overrides in `.dark` with brightened pool + low-chroma dark wash, matching the tennis pattern already there.

In `@theme inline`, expose them as Tailwind utilities:
```css
--color-secondary-accent: var(--secondary-accent);
--color-secondary-accent-wash: var(--secondary-accent-wash);
--color-secondary-accent-ink: var(--secondary-accent-ink);
```

This gives us `bg-secondary-accent`, `text-secondary-accent-ink`, `bg-secondary-accent-wash`, etc.

> Note: the existing `--color-secondary` is already mapped to `--elevated` for shadcn — we'll use the distinct `--color-secondary-accent` name to avoid collision.

### 2. Apply to athlete identity surfaces
- `coach.plans.tsx` plan cards: athlete name → `text-secondary-accent-ink`; athlete-scoped filter chip active state → pool wash + pool ink
- `coach.plans.$planId.tsx`: athlete header label → pool ink; the matched-athlete voice glow ring → pool
- Wherever a plain text-secondary athlete name appears, swap to pool ink

### 3. Apply to data/metadata surfaces
- Plan card meta row ("3 moves · Updated 2h") → `text-secondary-accent-ink` (or pool at reduced opacity for the meta dot row)
- `Draft` / `Template` / sport tag badges → pool wash background + pool ink text
- Move library tag pills in `move-sheet.tsx` → pool wash
- "From your voice" pill in `move-field.tsx` → pool wash + pool ink (currently tennis-tinted)

### 4. Leave untouched
- Body background gradient (stays tennis — gives the page its overall warmth)
- `pen-highlight` utility (stays tennis — it's the coach's voice mark)
- FABs, primary buttons, focus rings (stay tennis — they're actions)
- The per-user pen system in `data/theme.ts` is unaffected; `--secondary-accent` is a fixed second color, not pen-swappable

## Risk / things to verify

- Contrast: pool-ink on white card surfaces and on pool-wash needs to hit AA. We'll tune `--pen-pool-ink` lightness if needed.
- Two-color balance: after wiring, scan `/coach/plans`, the plan editor, and the move sheet to confirm pool reads as the "info" color and tennis as the "action" color — not 50/50 noise. If pool feels too loud, dial back to wash-only on metadata and keep ink only for athlete names.
