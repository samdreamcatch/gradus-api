## Goal

Merge the "Athlete" dropdown and "Save as template" toggle into one **Assign to** dropdown, and drive the bottom-right primary button + the Share-to-socials button off that selection.

## Dropdown (Assign to)

Replace the current athlete select + separate template Switch with a single dropdown ordered:

1. **Public / Shareable Link** — public plan (no athlete, no template)
2. **Save as Template** — library template
3. — divider —
4. Athlete Name 1
5. Athlete Name 2
6. …

Selected value drives everything below. The right-hand "Save as template" Switch and its border-left divider go away.

## Bottom-right primary button

Label + behavior swap based on the dropdown selection:

| Selection | Button label | On click |
| --- | --- | --- |
| Athlete | **Send to Athlete** | Existing `activate` flow (activates for that athlete; conflict dialog logic unchanged) |
| Public / Shareable Link | **Publish & Share** | Activates the plan with `athleteId: null`, then fires the native share sheet (reuses the prefetched token path from `ShareToSocialsButton`) |
| Save as Template | **Save to Library** | Existing `saveTemplate` flow |
| Nothing selected | **Send to Athlete** (disabled) | — |

Already-active plan keeps saying "Update & share" for the athlete case, "Publish & Share" for the public case.

## Share-to-socials button visibility

Sits where it does today (above the timeline / logged-instances section).

- **Athlete selected** → hidden (private plan).
- **Public / Shareable Link** → shown, visually promoted (slightly larger, filled accent instead of the current outline chip) so it reads as the headline action for this mode. Still works pre-activation via the existing prefetch path.
- **Save as Template** → hidden.

## Public plan tag

No DB change (UI-only). "Public" is derived at render time from `athleteId == null && !isTemplate`. Small `Public` chip rendered next to the plan title when true, so the coach can tell public plans apart in the editor. Existing plan list card gets the same chip via the same derivation.

## Technical notes

- File: `src/routes/_authenticated/coach.plans.$planId.tsx` only, plus a tiny visual variant prop on `src/components/plans/share-to-socials-button.tsx` (e.g. `variant?: "chip" | "primary"`) — no logic changes to the share flow itself.
- Dropdown built with the existing `MoveField kind="select"`, extending its options list with two sentinel values (`__public__`, `__template__`) handled in `onCommit` before the athlete-name lookup. Divider is rendered by injecting a disabled `<option>──────</option>` between sentinels and athletes in `SelectOrCombo`, gated by an optional `dividerAfter?: string[]` prop so no other caller changes behavior.
- "Publish & Share" click handler:
  1. `planUpdate.mutateAsync({ athleteId: null })` if not already null
  2. `statusFn({ status: "active" })` (skip the athlete-conflict pre-check; conflicts only apply per-athlete)
  3. Synchronously invoke `navigator.share(...)` via the prefetched token — same pattern the button already uses, just triggered from the primary CTA instead of the chip.
- Selecting **Save as Template** in the dropdown calls the existing `useTemplate.mutateAsync({ kind: "template", fromPlanId })` — same effect as flipping the old switch.
- The disabled state on the current button (`!plan.athleteId`) is replaced with `assignment == null` so Public and Template modes are always enabled.

## Out of scope

- No schema/migration changes; no new "shared externally" flag persisted server-side.
- No changes to `plan-share.functions.ts`, share-token generation, or the public `/p/:token` page.
- No change to how templates or athlete-assigned plans behave once activated.
