
# Messages tab — athlete, coach & parent

A single shared Messages experience used by all three roles. One conversation per coach↔athlete pair, with the athlete's parent automatically included.

## Behavior

- **Athlete:** sees one thread per coach. Parent is always in the thread.
- **Coach:** sees one thread per athlete on their roster. That athlete's parent is in the thread.
- **Parent:** sees one thread per (athlete × coach) pair. They receive every coach↔athlete message and can post into the same thread (effectively a 3-way room, not a CC).
- **Message types:** text + voice notes (up to ~90s).
- **Read receipts:** per-user `read_at` per message. Unread count rolls up to an **orange dot** on the bottom-nav Messages icon (design-system `bg-attention`).
- **Realtime:** new messages and read receipts stream in via Supabase Realtime.

## Visual design

- Reuses the **Plans tab header pattern**: same big title, `pen-highlight` (Tennis Green) band under the word "Messages", same subtitle slot. Subtitle reads role-appropriately ("Your coaches", "Your athletes", "Your athlete's coaches").
- Room list rows: avatar/initials, other participants, last-message preview, relative time, orange unread pill (`bg-attention` / `text-attention-ink`).
- Thread bubbles: own messages right-aligned on `bg-accent`; others left-aligned on `bg-elevated` with a small role label above ("Coach Tami", "Parent — Sara"). Day separators in `font-hand`.
- Composer: rounded text field + mic button. While recording, mic turns orange and shows elapsed time.

## Routes

Three thin role wrappers, each rendering the same shared components plus the role's existing `BottomNav`:

- `src/routes/_authenticated/athlete.messages.tsx` (list)
- `src/routes/_authenticated/athlete.messages.$roomId.tsx` (thread)
- `src/routes/_authenticated/coach.messages.tsx` + `coach.messages.$roomId.tsx`
- `src/routes/_authenticated/parent.messages.tsx` + `parent.messages.$roomId.tsx`

Bottom-nav `Messages` items get wired to `/{role}/messages` and show the unread dot from `getUnreadTotal()`.

## Shared UI (`src/components/messages/`)

- `MessagesHeader` — Plans-style header with `pen-highlight` band
- `RoomList` — rooms with unread pill
- `RoomView` — thread, day groups, voice player, "Seen by" line
- `Composer` — text input + voice recorder (reuses the existing voice infrastructure in `src/lib/voice.functions.ts`)

## Server functions (`src/lib/messages.functions.ts`)

- `listMyRooms()` — rooms visible to current user with last-message preview, unread count, last activity
- `getRoom({ roomId })` — room metadata + paginated messages
- `sendMessage({ roomId, kind, body?, audio? })` — inserts message; for voice, uploads to `voice-notes/{roomId}/{uuid}.webm` (≤8MB) and stores the URL + duration
- `markRoomRead({ roomId })` — upserts `message_reads` for all unread messages in the room
- `getUnreadTotal()` — single integer for the bottom-nav badge

All protected with `requireSupabaseAuth`.

## Database (one migration)

- `message_rooms(id, coach_id, athlete_id, created_at, updated_at)` — `unique(coach_id, athlete_id)`. Rooms auto-created on first send if missing.
- `messages(id, room_id, sender_user_id, sender_role 'coach'|'athlete'|'parent', kind 'text'|'voice', body, audio_url, duration_seconds, created_at)`
- `message_reads(message_id, user_id, read_at)` — PK `(message_id, user_id)`
- `is_room_participant(room_id, user_id)` security-definer helper — true if the user is the room's coach, the rostered athlete, or that athlete's linked parent
- RLS: SELECT/INSERT on `messages` and `message_reads` gated by `is_room_participant`; same on `message_rooms` (SELECT only — inserts go through server fn)
- Realtime: enable on `messages` and `message_reads`
- Storage: private `voice-notes` bucket, room-scoped read/write policies (path prefix = `roomId`)
- Standard GRANTs (authenticated + service_role; no anon)

## Realtime wiring

- `RoomView` subscribes to `messages` and `message_reads` filtered by `room_id` and invalidates the React Query keys for that room
- `RoomList` and bottom-nav badge subscribe to `messages` (any room the user participates in) and invalidate `listMyRooms` / `getUnreadTotal`

## Out of scope (this pass)

- Image/file attachments
- Typing indicators
- Edit / delete messages
- Push / email notifications
- Search within threads
- Group threads beyond the fixed 3-way (coach ↔ athlete ↔ parent)

## Technical notes

- Voice clips: capture with MediaRecorder (`audio/webm`), base64 across the wire (matches existing voice flow), server uploads to Storage and returns the public-ish signed URL stored on the message.
- Unread is derived: a message is unread for user U iff there is no `message_reads` row with `(message_id, U)`. The badge query selects `count(*)` of such messages across rooms `U` participates in.
- Parent linkage uses the existing athlete↔parent relation already established for the Plans flow (no new linkage model).
