## Goal

Add two new 1:1 direct-message surfaces alongside today's coach↔athlete/parent rooms:

1. **Coach ↔ Coach** — any coach can initiate, regardless of tier. Requires ≥1 shared roster athlete.
2. **Coach ↔ Parent (general)** — any coach ↔ any parent of an athlete on that coach's roster. This is a separate thread from the existing athlete-scoped room.

Under-18 athletes are never in a DM without a parent — the new rooms have zero athlete participants, so this holds by construction.

## Data model (new table)

Add `public.direct_rooms` — generic 1:1 rooms keyed by user pair, disjoint from `message_rooms`.

```
direct_rooms
  id              uuid pk
  kind            text check in ('coach_coach','coach_parent')
  user_a          uuid not null      -- least(user_id) of the pair
  user_b          uuid not null      -- greatest(user_id) of the pair
  coach_a_id      uuid null          -- coach_profiles.id (when kind=coach_coach)
  coach_b_id      uuid null          -- coach_profiles.id (when kind=coach_coach)
  coach_id        uuid null          -- coach_profiles.id (when kind=coach_parent)
  parent_id       uuid null          -- parent_profiles.id (when kind=coach_parent)
  created_at, updated_at
  unique (kind, user_a, user_b)
```

Reuse `messages` and `message_reads` by adding a nullable `direct_room_id` alongside the existing `room_id`:

- `messages.room_id` becomes nullable; add `messages.direct_room_id uuid null references direct_rooms(id) on delete cascade`.
- CHECK constraint: exactly one of `(room_id, direct_room_id)` is set.
- New `is_direct_room_participant(_direct_room_id, _user_id)` security-definer function; extend `messages` / `message_reads` RLS policies to allow the direct-room branch.
- Update `validate_message_plan` trigger to no-op when `direct_room_id` is set (no plan tagging in direct rooms).
- GRANTs + RLS policies on `direct_rooms` (participants view; controlled insert via server fn using service role, so a minimal `authenticated` SELECT policy is enough).

## Server functions (`src/lib/messages.functions.ts` + `messages.server.ts`)

Unify room shape in the DTOs while keeping wire compatibility:

- Extend `RoomSummary` / `RoomDetail` with `kind: "athlete" | "coach_coach" | "coach_parent"` and optional `directRoomId`. `coachId`/`athleteId` stay populated only for `kind="athlete"`.
- `listMyRoomIds` → also fetch `direct_rooms` where the caller is `user_a` or `user_b`, returning them with `kind` + `myRole` (`"coach"` for coach-coach, or the caller's role for coach-parent). Athletes never see direct rooms.
- `loadParticipants` → resolve the "other side" for direct rooms from `coach_profiles`/`parent_profiles`.
- `getRoom`, `sendMessage`, `markRoomRead`, `getUnreadTotal` → branch on `direct_room_id` vs `room_id`. `sendMessage` for direct rooms skips the `coach_athletes` link check and rejects `planId`.
- `listMyMessageTargets` (coach view) → append:
  - **Coach targets**: one entry per other coach sharing ≥1 athlete on caller's roster (deduped by `coach_id`). Labeled `"Coach {first} {last}"`, secondary lists shared athletes ("about Jamie & Sam").
  - **Parent targets**: one entry per parent on caller's roster (deduped when parent has multiple kids under this coach). Labeled `"Parent {first} {last}"`, secondary lists their athletes.
- `listMyMessageTargets` (parent view) → also expose "Coach (general)" targets so parents can initiate coach-parent DMs (still gated by an existing roster link to one of their kids).
- New `ensureDirectRoom({ kind, otherCoachId? , parentId? })` server fn. Enforces:
  - `coach_coach`: caller is a coach; shared athlete exists on both rosters.
  - `coach_parent`: caller is coach with parent on roster, OR caller is parent with coach on their kid's roster.
  - Normalizes `(user_a, user_b) = (least, greatest)` before insert; unique index dedupes regardless of initiator.

## UI

- `NewConversationButton` picker: group targets by header (`Athletes`, `Coaches`, `Parents`), each entry hits either `ensureRoomForTarget` (existing) or `ensureDirectRoom` based on target kind. Empty-state copy adapts by role.
- `RoomList` / `RoomView` header: render participants for direct rooms (no athlete pill; two-person title like "Coach Alex" or "Parent Jamie").
- `RoomView`: hide the plan-attach paperclip when `room.kind !== "athlete"` (no plan tagging in direct rooms).
- Routes reused: `/coach/messages/$roomId` and `/parent/messages/$roomId`. The `roomId` param resolves to either a `message_rooms.id` or `direct_rooms.id` — server tries both; UUID namespaces are disjoint. Athlete routes are unchanged.

## Access-control invariants

- Under-18 protection: direct rooms have no `athlete_id` column and never surface to athletes.
- No tier gate — every coach can start coach↔coach and coach↔parent DMs.
- Coach-parent link enforced at room creation only. If the coach is later removed from every athlete they share with that parent, existing room stays visible but `sendMessage` returns the same `coach_unlinked` refusal pattern the athlete-scoped rooms already use.

## Out of scope

- Group DMs (>2 participants).
- Plan tagging inside direct rooms.
- Notification/email routing changes (existing in-app unread + realtime cover it).
- Retro-migrating any existing chats.

## Technical notes

- `direct_rooms.user_a`/`user_b` normalization guarantees the unique index dedupes rooms regardless of who initiated.
- `getUnreadTotal` unions both room types before totaling; the badge already invalidates on any `messages` insert via the existing table-level realtime subscription, so no realtime plumbing changes.
- Rollout order: (1) migration for `direct_rooms` + `messages` changes + RLS + trigger update; (2) server-fn + UI wiring in one code batch after the migration lands.