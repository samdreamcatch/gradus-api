## Move detail + inline editor

Tapping the `>` on any library row opens a slide-up bottom sheet showing the move as a "notebook page." Every field is read-only at rest; tapping a field flips it to an editor in place and auto-saves on blur / Enter. Same component is reused by the `+` (new move) flow, so we ship the editor at the same time.

### UX

- **Surface**: `Sheet` (`side="bottom"`, max-h 85vh, scrollable) — matches `CreatePlanSheet` / `NewMoveStub`.
- **Open**: Library row becomes a `button`; chevron stays as visual affordance. Selected move id held in `coach.plans.tsx` state.
- **Layout** (notebook page, single column):
  1. Header: `name` (display serif, pen-highlight underline) + meta row `sport · category` chips
  2. Target pill: `[reps|minutes] × value` — tap to edit kind + value together
  3. **Cue** — Caveat font, larger, label "Cue"
  4. **Why** — body, label "Why this matters"
  5. **Description** — body, full width
  6. Footer actions: `Duplicate` (ghost), `Archive` (destructive ghost, with confirm)
- **Inline edit pattern**:
  - Tap field → swaps to `Input`/`Textarea` with current value focused
  - Blur or Enter (Esc cancels) → fires `upsertMove` mutation with full move payload + optimistic cache update
  - Toast on error, silent on success; pen-color border while dirty/saving
  - Sport + category use a small inline select populated from existing distinct values (free-text fallback)
  - Target uses a 2-control row: kind toggle (reps/minutes) + numeric input
- **New move flow**: `+` button opens the same sheet with a blank draft (no id). First save (name required) calls `upsertMove`, returns id, then subsequent field edits patch it. Sheet shows "New move" title until saved.

### Data

- Read: existing `listMoves` (already cached as `["moves"]`).
- Write: existing `upsertMove` server fn (handles create + update).
- Archive: existing `archiveMove`.
- Duplicate: client-side — call `upsertMove` with no `id`, copy all fields, append " (copy)" to name, invalidate `["moves"]`, switch sheet to the new id.

No schema or server-fn changes required.

### Files

- `src/components/coach/move-sheet.tsx` (new) — the sheet, view + inline-edit fields, duplicate/archive actions. Self-contained, takes `moveId | "new" | null` + `onOpenChange`.
- `src/components/coach/move-field.tsx` (new) — small primitive: renders read view, swaps to edit input on click, handles blur/Enter/Esc + dirty state. Variants: `text`, `textarea`, `select`, `target`.
- `src/routes/_authenticated/coach.plans.tsx` — wire library rows + `+` button (in library tab) to open `MoveSheet`; remove `NewMoveStub`.

### Design tokens

- Card surface (`bg-card`), `shadow-card`, `rounded-xl`
- Name: `font-display text-h2`, pen-highlight via `pen-highlight` utility
- Cue: `font-hand text-hand text-text-primary`
- Labels: `text-caption text-text-tertiary`
- Editing field: `border-accent/50 bg-elevated`, focus ring per design system
- Chips: existing `FilterChip` look (`border-divider bg-card`)

### Out of scope

- Adding media/video to moves
- Reordering or category management
- Bulk edit
- Plan editor (separate later task)
