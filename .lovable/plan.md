## Goal

Give coaches full control over their roster and weekly schedule from two places: inline on the existing pages, and in a new "Roster & schedule" management section in Settings. All mutations are server-fn'd, auth-scoped to the signed-in coach, and respect RLS.

## Scope

### Roster
- **Remove athlete from roster** — unlinks (does not delete the athlete account).

### Schedule (recurring weekly lessons)
- **Add** a recurring weekly lesson (athlete + weekday + start/end).
- **Edit** day or start/end of an existing slot.
- **Delete** a slot.
- **One-off override for a single date**: cancel that date, or reschedule it to a new start/end (same day).

### Entry points
- Inline icon buttons on `RosterCard` and `LessonRow`/day view (edit, delete, cancel-this-date).
- New "Roster & schedule" disclosure section in `/coach/settings`, listing each rostered athlete with their slots, an "Add slot" button, and a "Remove from roster" action.

## Out of scope

- Creating new athlete accounts. Coaches still add athletes via existing invite-code flow (parent claims, then auto-links).
- Changing slot `frequency` beyond weekly (existing data model supports it; we keep the current "treat as weekly" assumption and don't expose biweekly/monthly UI yet).
- Editing athlete profile fields (name, sport, hours goal) — kept out per user's roster-scope answer.

## Data model changes

New table for one-off date overrides on a recurring slot:

```sql
public.lesson_slot_overrides
  id uuid pk default gen_random_uuid()
  slot_id uuid not null references athlete_lesson_slots(id) on delete cascade
  occurrence_date date not null            -- the specific calendar date being overridden
  status text not null check (status in ('canceled','rescheduled'))
  start_minute int                         -- required when status='rescheduled'
  end_minute   int                         -- required when status='rescheduled'
  created_at / updated_at timestamps
  unique (slot_id, occurrence_date)
```

Migration includes GRANTs (`authenticated`, `service_role`) and RLS policies scoped to "the coach who owns the parent slot":

```sql
using (exists (select 1 from athlete_lesson_slots s
               join coach_profiles cp on cp.id = s.coach_id
               where s.id = lesson_slot_overrides.slot_id
                 and cp.user_id = auth.uid()))
```

with the same expression as `with check`.

A validation trigger enforces `start_minute`/`end_minute` presence + ordering when `status = 'rescheduled'` and forbids them when `status = 'canceled'`.

## Server functions

New file `src/lib/coach-roster-mutations.functions.ts` — all use `requireSupabaseAuth` and resolve `coach_id` from `coach_profiles.user_id = context.userId`:

| Fn | Input | Behavior |
|---|---|---|
| `removeAthleteFromRoster` | `{ athleteId }` | Delete from `coach_athletes` for `(coachId, athleteId)`. Trigger `cleanup_coach_athlete_sports` already wipes sport mappings. Also null out `coach_id` on that athlete's `athlete_lesson_slots` rows owned by this coach (or delete — see note). |
| `addLessonSlot` | `{ athleteId, dayOfWeek, startMinute, endMinute }` | Insert into `athlete_lesson_slots` with `frequency='weekly'`, `coach_id=coachId`. Validates athlete is on this coach's roster. |
| `updateLessonSlot` | `{ slotId, dayOfWeek?, startMinute?, endMinute? }` | Update verified-owned slot. |
| `deleteLessonSlot` | `{ slotId }` | Delete verified-owned slot (cascade removes overrides). |
| `cancelLessonOccurrence` | `{ slotId, date }` | Upsert override `status='canceled'`. |
| `rescheduleLessonOccurrence` | `{ slotId, date, startMinute, endMinute }` | Upsert override `status='rescheduled'` + times. |
| `clearLessonOverride` | `{ slotId, date }` | Delete override (uncancel / undo reschedule). |

Each verifies ownership via a join against `coach_profiles.user_id = context.userId` before mutating.

Roster slot delete choice: **null out `coach_id`** rather than hard-delete, so the slot survives if another coach is later linked. (Matches the existing `claimParentInvite` pattern that re-claims null-coach slots.)

### Read-side updates

- Extend `getCoachRoster` to also fetch overrides keyed by athlete, returning `RosterSlot.overrides: { date, status, startMinute?, endMinute? }[]`.
- `WeekScheduleView` builds `sessionsByDay` honoring overrides for the displayed week: skip canceled occurrences, swap times for rescheduled ones. Add a small "Rescheduled" / "Canceled" pen-pink chip on affected rows.

## UI work

### 1. Inline on `/coach/roster` — Athletes tab
`RosterCard` gets an overflow menu (3-dot `DropdownMenu`) with:
- "Remove from roster" → `AlertDialog` confirm → calls `removeAthleteFromRoster`, invalidates roster query.

### 2. Inline on `/coach/roster` — Schedule tab
`LessonRow` (expanded state) gets a row of icon actions above the "View athlete" button:
- **Edit** → opens `LessonSlotSheet` (new) bound to that slot.
- **Cancel this date** → AlertDialog → `cancelLessonOccurrence(slotId, selectedDate)`.
- **Reschedule this date** → opens `LessonSlotSheet` in "occurrence" mode with date prefilled.
- **Delete recurring** → AlertDialog ("This removes the weekly lesson for all future dates") → `deleteLessonSlot`.

Day-header gets an **"Add lesson"** button that opens `LessonSlotSheet` in "create" mode with the selected weekday prefilled and an athlete picker (rostered athletes only).

If a row has an override for the selected date, show a small chip + an "Undo override" affordance.

### 3. New `LessonSlotSheet` component
`src/components/coach/lesson-slot-sheet.tsx` — bottom `Sheet`, follows `MoveSheet` patterns.

Fields:
- Athlete (combobox; disabled in edit mode).
- Day of week (segmented control of 7 days; in "occurrence" mode this is locked to the date's weekday and shown as read-only date).
- Start time + end time (native `<input type="time">` or two scrollable selects; keep it simple and accessible — no new deps).

Mode matrix:

```text
mode        | calls
create      | addLessonSlot
edit        | updateLessonSlot
occurrence  | rescheduleLessonOccurrence (or clearLessonOverride if user picks "Cancel override")
```

Footer: primary "Save", secondary "Cancel". In edit mode also a "Delete recurring lesson" link → confirm → `deleteLessonSlot`. In occurrence mode also "Cancel this date" → `cancelLessonOccurrence`.

### 4. Settings — new "Roster & schedule" disclosure
Add to `src/routes/_authenticated/coach.settings.tsx` under the "Coaching" group. Shows a list of rostered athletes; each row:
- Athlete name + sport(s).
- Compact list of weekly slots (`Mon 4–5p`) with edit/delete icons.
- "Add slot" button.
- "Remove from roster" link (AlertDialog confirm).

Reuses `LessonSlotSheet` and the same mutation fns.

## Cache invalidation

After every mutation, invalidate:
- `["coach", "roster"]` (drives both pages and settings)
- `["coach", "roster", "summaries"]` if slot change affects the displayed week
- Athlete-detail query for the affected athlete

Use `queryClient.invalidateQueries` from the mutation `onSuccess`.

## Files touched

**New**
- Migration: `lesson_slot_overrides` table + GRANTs + RLS + trigger
- `src/lib/coach-roster-mutations.functions.ts`
- `src/components/coach/lesson-slot-sheet.tsx`
- `src/components/coach/roster-settings-section.tsx`

**Edited**
- `src/lib/coach-roster.functions.ts` — return overrides
- `src/components/coach/week-schedule-view.tsx` — render overrides + add inline actions + "Add lesson" button
- `src/components/coach/roster-card.tsx` — overflow menu with "Remove"
- `src/routes/_authenticated/coach.settings.tsx` — mount new section
- `src/integrations/supabase/types.ts` — regenerated after migration

## Verification

- Add a lesson → appears on schedule + settings; refresh persists.
- Edit time → display updates everywhere.
- Delete recurring → gone from all future weeks; settings reflects.
- Cancel single date → that date hides the lesson with a "Canceled" chip; other weeks unaffected.
- Reschedule single date → time changes only for that date; chip shown.
- Remove athlete → disappears from roster, schedule, and settings; their account/data untouched; a new claim via invite code re-links them.
- Hit RLS: a coach can only mutate slots/overrides for their own rostered athletes (verify by inspecting policies + a manual cross-account spot-check in dev).
