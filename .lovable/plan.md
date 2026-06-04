## Goal

When a parent disconnects a coach from an athlete, any further messages in that conversation should fail with a clear error toast — currently the coach (and athlete/parent) can still send messages into the orphaned room because `sendMessage` only checks that the user is a participant of the existing room, not that the underlying coach↔athlete link still exists.

## Change

In `src/lib/messages.functions.ts`, inside the `sendMessage` handler (around line 230, right after resolving `room` and `role`):

1. Query `coach_athletes` for a row matching `room.coach_id` + `room.athlete_id`.
2. If no row exists, throw `new Error("This coach is no longer connected to this athlete. New messages can't be sent.")` before any voice upload or insert.

That's the only server change. The client side already surfaces thrown errors:

- `RoomView` (`src/components/messages/room-view.tsx`) — `sendTextMutation.onError` shows a `toast.error("Couldn't send", { description: e.message })`. Voice sends go through the same mutation path indirectly via `sendFn`, so they'll surface the same toast.
- `MessageCoachAboutPlanDialog` — already toasts `e.message` on error.

No DB migration, no schema change, no UI change beyond the existing toast.

## Out of scope

- Hiding/locking the composer in disconnected rooms (could be a follow-up; today the error toast is enough per the request).
- Auto-archiving or deleting orphaned rooms.
- Changing `ensureRoom` / `ensureRoomForTarget` (those already validate the link when creating a room).
