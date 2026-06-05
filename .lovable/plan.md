### Problem

The Ask Gradus textarea sits inside a bright gradient border (`from-secondary-accent via-accent to-secondary-accent`) that doesn't match the muted, paper-like surfaces used elsewhere on `/parent/resources` (library list, saved answers, answer card).

### Change

In `src/routes/_authenticated/parent.resources.index.tsx` (the `AskGradusCard` component), replace the gradient wrapper with the same surface treatment used for the answer + saved cards:

- Drop the `p-[2px]` gradient `<div>` wrapper.
- Render the input area as a single `rounded-2xl border border-divider bg-card p-4` container, matching the answer/saved-answer cards.
- Keep the textarea transparent so the card surface shows through; keep the Ask button styling unchanged.

No behavior, copy, or layout changes — purely a visual alignment with the design system.