## Goal

Sweep the remaining hand-rolled eyebrow labels in the coach plan editor and the admin routes to use the `<Eyebrow>` primitive, extending the primitive only as needed to codify what the current app already does. Where an existing element mixes an eyebrow with a full decorative wrapper (chip, pill, tab, button), the wrapper stays hand-rolled this batch — that's a separate "Chip" primitive later.

## Extending `Eyebrow` to match reality

Two additions so the sweep is pure refactor (zero visual drift):

1. **New size `small` (12px = `text-xs`)** — used for the "Internal" / "Admin" page-header eyebrows and section labels in the admin routes. Current sizes stay: `nano` (9), `micro` (10), `caption` (11), plus new `small` (12).
2. **New `tracking` prop** — `"wide" | "widest"`, default `"widest"`. A handful of eyebrows in the plan editor and admin tabs use `tracking-wide` today; codify that variant instead of forcing them to widen.

No other prop or token changes. Docstring at the top of `eyebrow.tsx` updates to list the four sizes and the tracking option.

## In scope (pure-text eyebrow labels only)

Files and approximate counts (each conversion is: strip the raw uppercase/tracking/size/tone classes, keep only layout classes like `mb-1 block` / `truncate` via `className`, pick matching `size`/`tone`/`weight`/`tracking`/`as`):

- `src/routes/_authenticated/coach.plans.$planId.tsx` — ~19 label/span eyebrows around form fields, filter labels, section markers (lines 546, 646, 662, 700, 962, 972, 1207, 1393, 1515, 1539, 1558, 1567, 1582, 1593, 1625, 1750, 1779, 1798, 1983, 2049, 2061, 2078). `<label htmlFor>` sites pass `as="label"`.
- `src/routes/_authenticated/admin.errors.$id.tsx` — 4 (back link text, two section headers, key label).
- `src/routes/_authenticated/admin.emails.tsx` — 4 (page eyebrow "Internal", category labels, panel headers, field label).
- `src/routes/_authenticated/admin.feedback.tsx` — 2 (back link text, page eyebrow, inline meta span).
- `src/routes/_authenticated/admin.map.tsx` — 1 (page eyebrow "Internal").
- `src/routes/_authenticated/admin.index.tsx` — 4 (page eyebrow "Internal", "Beta invite code", two `<StatLabel>`-style `text-[10px]` labels, one `text-xs text-accent-ink` tag).
- `src/routes/_authenticated/admin.list.$kind.tsx` — 1 (page eyebrow "Admin").
- `src/routes/_authenticated/admin.errors.tsx` — 2 (back link text, page eyebrow "Internal").
- `src/routes/_authenticated/admin.users.$userId.tsx` — ~6 (page eyebrow, section labels, dt labels in the definition list — including the `SectionLabel` helper).
- `src/routes/_authenticated/admin.promo-codes.tsx` — 2 (back link text, table `<th>` row with `text-[11px] uppercase tracking-wider text-text-tertiary`).

Every one of these is currently a pure `<p>`/`<span>`/`<label>`/`<th>`/`<dt>` with the same uppercase+tracking+size+tone shape the primitive already models.

## Explicitly out of scope this batch

To keep the churn safe and reviewable, don't touch anything where the eyebrow text is welded to a decorative wrapper — those get a separate Chip/Pill primitive later:

- Any `rounded-pill border … uppercase` chip, tab, or filter button (admin tabs, roster filter chips, the tone tabs inside the plan editor at lines 1222 / 1604).
- Any `font-mono uppercase` tag pill (`test`, `adult`, `custom`, `unsaved`, promo code cells).
- The circular accent chip at plans line 532 (`rounded-full bg-accent … text-accent-foreground`).
- The "coach mode" toggle button at admin.index line 73 and its siblings — those are buttons, not eyebrows.
- The `pen-highlight` wrappers around bottom-nav / eyebrow labels — the highlight background stays a `<span>` around the child; the eyebrow inside can still convert if it's pure text, but the wrapper doesn't change.

## Verification per file

After each file's edits: read the file back, run `rg 'uppercase tracking-(wid|wide)' <file>` to confirm only wrapper-attached eyebrows remain, and visually check that the file still builds. No behavioral change; typography values are unchanged because the primitive now has both `wide`/`widest` and the `small` (12px) size.

## Technical notes

- Line numbers above are pre-edit references from the current tree; edits will be applied by matching the exact `<p|span|label|th|dt className="…">` snippet, not by line number.
- `Eyebrow` forwards `...rest`, so `htmlFor` on `<label>` and `scope` on `<th>` keep working via `as="label"` / `as="th"`.
- `SectionLabel` helper in `admin.users.$userId.tsx` (line ~194) becomes a one-line wrapper around `<Eyebrow as="dt" size="small" tone="tertiary">`; call sites unchanged.
- No changes to `src/styles.css`, no new tokens, no theme edits.

## What this codifies

The current app's eyebrow vocabulary is: four sizes (9/10/11/12px), five tones already in the primitive, two tracking widths, two weights. After this batch, that's exactly what the primitive exposes and nothing more — the design system doc gets simpler, not larger.
