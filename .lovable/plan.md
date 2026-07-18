Remove the "Upgrade to see plans" hand-written line from the locked state in `src/components/coach/also-coached-by-list.tsx`.

When `locked` is true, the `<p>` tag rendering "Upgrade to see plans" (lines 61-72) will be suppressed. The non-locked states are preserved:
- `coachMeta(c)` still shows for unlocked coaches with plans
- "No shared plans yet" still shows for coaches with no plans

The "UPGRADE TO SEE PLANS" pill badge + lock icon on the right side remain as the sole indicator of the locked state.