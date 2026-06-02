## Goal
Give parents on `/parent/messages` the same "New" affordance coaches have, reusing one component. Each row in the picker reads as a coach name with the athlete it's about as a subline.

## Backend (new server fns in `src/lib/messages.functions.ts`)

1. **`listMyMessageTargets`** (auth'd, GET) — role-aware list for the picker.
   - **Coach caller**: returns rostered athletes as `{ athleteId, primaryLabel: athlete name, secondaryLabel: null }`.
   - **Parent caller**: joins `athletes` (where `parent_id = me.parent.id`) → `coach_athletes` → `coach_profiles`, returns one row per (athlete × coach) as `{ athleteId, primaryLabel: "Coach {first} {last}", secondaryLabel: "about {athlete first name}" }`. If an athlete has no linked coach yet, omit it.
   - Sorted by primary label.

2. **`ensureRoomForTarget`** (auth'd, POST, `{ athleteId }`) — role-aware room upsert.
   - Coach branch: existing `ensureRoomForAthlete` logic (verify roster, upsert room).
   - Parent branch: verify `is_parent_of_athlete(athleteId)` via `athletes.parent_id = me.parent.id`, find that athlete's `coach_id` from `coach_athletes`, then upsert `message_rooms (coach_id, athlete_id)` the same way.
   - Returns `{ id }`.
   - The existing `ensureRoomForAthlete` stays for now (used by `NewConversationButton`'s current import) but the refactored button will switch to `ensureRoomForTarget`. We can delete the old one after the switch.

No DB migration needed — `message_rooms`, `coach_athletes`, `athletes`, `parent_profiles`, and `is_room_participant` already cover this case.

## Frontend

3. **Refactor `src/components/messages/new-conversation-button.tsx`** to a shared component:
   - Props: `fetchTargets` (serverFn ref), `openRoom` (serverFn ref), `basePath: "/coach/messages" | "/parent/messages"`, `roomsQueryKey: unknown[]`, `targetsQueryKey: unknown[]`, `emptyState: { icon?, message }`.
   - Renders each row with `primaryLabel` bold + optional `secondaryLabel` as a small caption underneath.
   - On success: invalidate `roomsQueryKey`, close dialog, navigate to `${basePath}/${id}`.

4. **`src/routes/_authenticated/coach.messages.index.tsx`** — pass coach wiring (`listMyMessageTargets`, `ensureRoomForTarget`, `/coach/messages`, key `["message-rooms","coach"]`, empty "No athletes on your roster yet.").

5. **`src/routes/_authenticated/parent.messages.index.tsx`** — add the same button in a `flex justify-between` header (mirroring the coach page), pass parent wiring (same fns, `/parent/messages`, key `["message-rooms","parent"]`, empty "No coaches linked to your athletes yet.").

## Out of scope
- No changes to `room-view`, compose bar, plan-tagging, or RLS.
- No new tables / migrations.
- Existing "Message coach about this plan" dialog on `/parent/plans/$planId` is untouched — it already routes here.

## Files touched
- `src/lib/messages.functions.ts` — add two server fns
- `src/components/messages/new-conversation-button.tsx` — generalized + row renders 2-line label
- `src/routes/_authenticated/coach.messages.index.tsx` — pass props
- `src/routes/_authenticated/parent.messages.index.tsx` — add header layout + button