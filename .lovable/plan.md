Bring the session-complete dialog (and all dialogs) in line with the rest of dark mode by raising the dialog surface from background to card, adding a proper border, and stepping the textarea up to elevated so it stays visible inside the lifted dialog.

## Changes

**1. `src/components/ui/dialog.tsx` — `DialogContent` (global fix, all dialogs benefit)**

- Surface: `bg-background` → `bg-card` (matches plan cards, settings, message rooms).
- Border: add `border-divider` so the framing reads like other surfaces.
- Polish: `sm:rounded-lg` → `rounded-2xl` and add `shadow-card` to match the rest of the dark-mode surface system. Bump padding `p-3` → `p-5` so content doesn't sit flush against the edge.

**2. `src/routes/_authenticated/parent.plans.$planId.tsx` — feedback textarea (line 509)**

- Textarea: `bg-card` → `bg-elevated` so it stays visually distinct from the now-lifted dialog body. Same edit in `src/routes/_authenticated/athlete.plans.$planId.tsx` if the equivalent textarea exists there.

**3. Eyebrow color (small consistency nudge, optional but recommended)**

- "Session complete · 00:02" currently uses `text-text-secondary`. Switch to `text-accent-ink` to match the eyebrow style used elsewhere (e.g. settings header) so the dialog's typographic system feels native to the app.

## Why this is the right scope

- The cream text token is already correct everywhere in this dialog — no text-color changes needed.
- Fixing `DialogContent` once propagates the improvement to every modal (message-coach dialog, plan move dialogs, etc.) instead of patching one popup.
- Light mode is unaffected: `--card` in light mode is a translucent white that sits cleanly on the page wash, so a dialog on `bg-card` in light mode still reads as a floating sheet.

## Verification after edits

- `text-text-primary` (L 0.945) on new dialog surface `--card` (L 0.255) → ~13.5:1, AAA.
- `text-text-secondary` (L 0.88) on card → ~11:1, AAA.
- Textarea on `--elevated` (L 0.285) inside dialog on `--card` (L 0.255) → ~0.03 L delta, plus the `border-divider` keeps the input visibly bounded.