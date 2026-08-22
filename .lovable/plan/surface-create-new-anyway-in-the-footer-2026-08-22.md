# Surface "create new anyway" in the footer

Today, when a new move name looks like something already in the library, the only way past the duplicate warning is a small uppercase text link buried at the bottom of the warning box. It's easy to miss.

## Change

Move that escape hatch out of the warning card and into the sticky footer, directly beside **Save to library & add**.

- Footer becomes: `Back` (left) · `Create new anyway` toggle + `Save to library & add` (right).
- The toggle only appears when duplicate suggestions are showing; otherwise the footer is unchanged.
- Rendered as an existing outline/ghost `Button` (same size as the save button) so it reads as a real choice, not fine print. When active it shows a check state and the save button becomes enabled.
- The duplicate card keeps its list of "Use" suggestions, minus the buried link, plus a one-line hint that they can create a new move instead.
- Typing a new name still resets the toggle, as it does now.

## Technical notes

Single file: `src/routes/_authenticated/coach.plans.$planId.tsx`. Remove the `<button>` at the bottom of the dupes block (~line 1647) and render the `ignoreDupes` toggle in the sticky footer (~line 1761) using the existing `Button` component and design tokens. No logic or data changes — `canCreate` already depends on `ignoreDupes`.
