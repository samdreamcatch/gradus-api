
## What changes

In `src/routes/_authenticated/parent.plans.$planId.tsx` and `src/routes/_authenticated/athlete.plans.$planId.tsx`, inside `MoveCard`'s expanded body:

- Replace the standalone description block + "How do I cue this?" chip with a **segmented "How / What" toggle** that shares one body slot.
- **Default = How (cue).** Tapping **What** swaps the body to the description.
- The segmented control only renders when both `move.cue` and `move.description` exist. Fallbacks:
  - Cue only → render cue body, no toggle.
  - Description only → render description body, no toggle.
  - Neither → render nothing.
- "Why is this assigned?" stays exactly as today: an accent chip that reveals the filled `CoachNote` panel with a close button.
- Remove the `cue` half of the `shown` / `show` / `hide` state. Keep the `why` half.

## UI shape

```text
3 reps   Bench press                              ⌄
─────────────────────────────────────────────────
[ How ] [ What ]              ← segmented, How active by default

Brace your core before unracking. Eyes forward,
drive through the heels…

[ Why is this assigned? ]
```

## Design system usage

Segmented control built from existing tokens — no new primitives:

- Container: `inline-flex rounded-full border border-divider bg-card p-0.5`
- Segment (inactive): `rounded-full px-3 py-1 text-xs font-bold text-text-tertiary`
- Segment (active): `rounded-full px-3 py-1 text-xs font-bold bg-accent/10 text-accent-ink border border-accent/60`
- Body: unchanged from today's description styling (`text-[15px] leading-relaxed text-text-primary`), so swapping content doesn't reflow weight.

Labels stay short: **How** and **What** (not "How to cue" / "Description") — terser, matches the segmented-control idiom.

Local state: `const [view, setView] = useState<"how" | "what">("how")` inside `MoveCard`. Resets naturally when the card unmounts; no persistence.

## Accessibility

- Use `role="tablist"` on the container, `role="tab"` + `aria-selected` on each segment, `role="tabpanel"` on the body.
- Keyboard: native button focus is enough; left/right arrow handling can be added later if needed.

## Files touched

- `src/routes/_authenticated/parent.plans.$planId.tsx` — update `MoveCard` body, remove cue chip + cue state, add segmented toggle.
- `src/routes/_authenticated/athlete.plans.$planId.tsx` — same change so the two views stay in sync.

No backend, schema, or data-shape changes. `move.cue` / `move.description` / `move.why` fields are already on `ParentPlanMoveDTO`.
