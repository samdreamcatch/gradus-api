
# Simplify overlay design language (Option B)

## The doctrine (locked in)

Three surfaces, one-line rules. Everything else is not allowed.

| Surface | When | Visual |
|---|---|---|
| **Sheet** (bottom on mobile, right on desktop) | Anything that is a *view* — forms, pickers, editors, drill-downs, multi-section content | `paper-surface` — feels like another page of the notebook |
| **Popover / Dropdown** | Anything anchored to a specific trigger — calendars, small menus, inline pickers, tooltips-with-actions | `bg-popover`, **top-aligned on mobile** (see below) |
| **AlertDialog** | *Destructive or irreversible confirms only.* Centered, opaque, red primary action | `bg-popover` |

Mental shortcut: **centered box = something is about to be deleted.** Everything non-destructive is either a sheet or anchored to its trigger.

Explicitly retired: plain `Dialog`. New modals reach for Sheet or AlertDialog.

## Mobile popover positioning rule (new)

**On mobile (< sm breakpoint), popovers anchor to the top of the viewport, not to their trigger.** Reason: the trigger is often mid-page, the popover contains a text input, and the on-screen keyboard covers the bottom half — hiding the popover content.

Implementation: modify our shared `PopoverContent` primitive so that on mobile it uses fixed positioning near the top (e.g. `top-4` with `max-w-[calc(100vw-2rem)]` and centered horizontally) instead of Radix's anchored positioning. Desktop behavior stays anchored to trigger. One change to `src/components/ui/popover.tsx` handles every popover in the app.

Applies to all popover-shaped surfaces: `Popover`, sport multiselect's `Command` popover, calendar pickers, message composer's "tag a plan" picker, move sheet's "add to plan" picker, dropdown menus.

## Migrations (concrete)

### Dialog → Sheet
| Current | Reason |
|---|---|
| `feedback/feedback-fab.tsx` `FeedbackDialog` | Free-text form |
| `plans/message-coach-about-plan-dialog.tsx` | Free-text form |
| `plans/session-feedback-modal.tsx` | Multi-field form (rating + note) |
| `_authenticated/coach.roster.tsx` "Add athletes" dialog | Two-section view (share code + enter code) — already visibly cramped |
| `messages/new-conversation-button.tsx` | People-picker list, functionally a sheet-shaped picker |

### AlertDialog → Sheet
These are forms/lists in confirm clothing:
| Current | Reason |
|---|---|
| `coach.plans.$planId.tsx` "Save to library" | Contains input fields |
| `coach.plans.$planId.tsx` "Update in library" | Contains input fields |
| `coach.plans.$planId.tsx` "Save as new library move" | Contains input fields |
| `coach/lesson-wrap-up-provider.tsx` multi-pending variant | List of pending lessons with per-row actions |

### Dialog → inline (no overlay)
| Current | Replacement |
|---|---|
| `signup.athlete.adult.tsx`, `signup.coach.tsx`, `signup.parent.tsx` captcha dialogs | Inline captcha step inside the signup form. Also consolidate the three copy-pasted implementations into one shared component. |
| `connection-celebration.tsx` (and its preview harness) | Dismissable inline banner on the destination page ("You're connected — start here"). Route decides which banner variant to show based on new-connection state. |

### Stay as AlertDialog (unchanged)
Genuine destructive/irreversible confirms:
- Delete plan (`coach.plans.tsx`, `coach.plans.$planId.tsx`)
- Remove athlete from roster (`coach/roster-card.tsx`, `coach/roster-settings-section.tsx`)
- Archive move (`coach/move-sheet.tsx`)
- Delete recurring lesson / Cancel single date (`coach/lesson-slot-sheet.tsx`)
- Name-conflict rename-vs-overwrite (`coach/name-conflict-dialog.tsx`) — 2-choice decision, no input

### Popover / Dropdown
All 6 popovers and the one dropdown stay put as popovers — they're correctly scoped anchored pickers. The only change is the shared top-alignment behavior on mobile described above.

## Doctrine artifacts

1. **Memory**: add `mem://design/overlay-doctrine.md` with the three-surface rule, the mobile top-alignment rule, and the retirement of plain Dialog. Update `mem://index.md` to reference it, and add a Core one-liner so it applies to every new feature.
2. Note in the memory file that new code should not import `Dialog` / `DialogContent` directly (still used by AlertDialog internals, but off-limits as an app surface).

## Execution order (each is a small, shippable turn)

1. Write the memory files (doctrine + index update).
2. Modify `src/components/ui/popover.tsx` for mobile top-alignment (affects every popover at once).
3. Migrate `feedback-fab` Dialog → Sheet.
4. Migrate `message-coach-about-plan-dialog` Dialog → Sheet.
5. Migrate `session-feedback-modal` Dialog → Sheet.
6. Migrate `coach.roster.tsx` add-athletes Dialog → Sheet.
7. Migrate `new-conversation-button` Dialog → Sheet (picker).
8. Migrate the 3 library-save AlertDialogs in `coach.plans.$planId.tsx` → Sheets.
9. Migrate `lesson-wrap-up-provider` multi-pending AlertDialog → Sheet.
10. Consolidate + inline the three signup captcha dialogs.
11. Replace `connection-celebration` Dialog with an inline banner on the destination route; delete/adapt the celebration-preview harness.

Batch a few per turn or ship one at a time — your call.

## Out of scope (intentionally)

- Whether the plan editor should be a route rather than a giant sheet (separate question).
- Visual restyling of AlertDialog / Sheet / Popover — same components and tokens; only *which surface gets used where* is changing (plus the mobile popover position).
