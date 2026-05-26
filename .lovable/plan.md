# First-name welcome + Handwritten font accessibility pass

## 1. First-name welcome

**File:** `src/routes/_authenticated/coach.tsx`

- Change the welcome line to use `firstName` only, falling back to `"Coach"` when empty.
- Keep the `pen-highlight` styling on the name.

```
const displayName = data.profile.firstName.trim() || "Coach";
// <h1>Welcome back, <span className="pen-highlight">{displayName}</span></h1>
```

No other surfaces currently render the full name, so this is a one-line change.

## 2. AAA accessibility pass on the handwritten font (Caveat)

### What AAA actually requires
- **Contrast:** 7:1 for normal text, 4.5:1 for "large" text (≥18.66px bold or ≥24px regular).
- **Readability:** WCAG SC 1.4.8 (AAA) — users must be able to read content without decorative-script barriers. Cursive/script fonts like Caveat are allowed, but only when:
  - they're **not the sole carrier** of essential info (a sighted user with low vision or dyslexia must still be able to parse it), and
  - they're rendered at a comfortable size and weight.

### Audit of current Caveat usage

| File | Line | Context | Issue |
|---|---|---|---|
| `coach.tsx` | 75 | `font-hand text-text-secondary` inside a `text-sm` row — renders Caveat at **14px** showing `"{hours} hrs / week"` | Too small for a script face; carries the essential hours value; contrast borderline at this size |
| `coach.settings.tsx` | 280 | `font-hand text-sm text-text-secondary` — hint text | 14px Caveat is hard to read; hint is non-essential so contrast can be relaxed but size shouldn't be |
| `onboarding.tsx` | 251 | `font-hand text-sm text-text-secondary` — hint text | Same as above |
| `onboarding.tsx` | 370 | `font-hand text-text-secondary` — review summary value | Carries essential info in script |

### Token check (already in `src/styles.css`)
- `--text-secondary` is annotated `~7.2:1` on background → **passes AAA for normal text** in sans, but Caveat's thin strokes effectively reduce perceived contrast. Safer to use `--text-primary` (or `--accent-ink`) wherever Caveat carries data.
- `--text-tertiary` is "AAA large / AA normal" → **not safe** under Caveat at small sizes. Not currently used with `font-hand`, keep it that way.

### Fixes

**A. Never render essential data only in Caveat.**
- `coach.tsx:75` — the "12 hrs / week" value is the data. Replace `font-hand` with the regular sans body face and keep `text-text-secondary`. Reserve Caveat for the surrounding annotation feel (e.g., the "hrs / week" suffix or a separate label), not the number itself.
- `onboarding.tsx:370` (review step) — same treatment: render the value in sans, AAA contrast.

**B. When Caveat is decorative (hints), make it pass the "large text" bar.**
- Bump `font-hand` hint instances from `text-sm` (14px) to **`text-lg` (18px) with `font-bold`** (Caveat is loaded at 500/700; use 700). This pushes it into the large-text AAA bracket (4.5:1) and improves legibility.
- Switch the color from `text-text-secondary` to **`text-accent-ink`** for hints, which is the darkest pen color on paper and is the ink token designed for this case.
- Apply to `coach.settings.tsx:280` and `onboarding.tsx:251`.

**C. Add a global rule in `src/styles.css` so future Caveat usage stays safe.**

Add a `.font-hand` base rule that ships a minimum line-height and slightly heavier default weight, so a developer who reaches for it can't accidentally render 14px regular Caveat:

```
@layer base {
  .font-hand {
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: 0.005em;
  }
}
```

### Verification

After the edits, sanity-check at the current `/coach` viewport (390×815) that:
- the welcome reads "Welcome back, **Maxwell**" (first name only),
- the per-level rows show hours in the sans face,
- the Caveat hints render at ~18px bold in `--accent-ink`.

No contrast math regressions expected since the tokens themselves don't change.

## Out of scope
- No changes to the pen color system, layout, or data model.
- No new components.
- Dark-mode tokens already mirror the light-mode AAA posture; no separate fix needed.
