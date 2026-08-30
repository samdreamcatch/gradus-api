# Account deletion, with message tombstones

## What I verified first

- There is **no** `20260830120000_account_deletion_schema.sql` and no hard-delete path anywhere. The only "delete" today is `adminSoftDeleteUser`, which bans the auth user for 100 years and writes a `soft_deleted_users` row. So the migration Claude's prompt builds on doesn't exist, and its assumption that "coach_profiles rows are retained de-identified" is not true today.
- `coach_profiles.user_id` and `parent_profiles.user_id` are **`NOT NULL` with `ON DELETE CASCADE` to `auth.users`**. `direct_rooms.coach_id / coach_a_id / coach_b_id / parent_id` all cascade from those profiles, and `messages.direct_room_id` cascades from `direct_rooms`. So today, deleting *any* auth user in a DM thread wipes the whole thread — both parties' messages — not just the parent's. Claude's Step 2 fixes one leg of that chain out of four.
- `messages.sender_user_id` really is a bare uuid with no FK, `body` is `NOT NULL DEFAULT ''`, and `messages` RLS SELECT is room-membership based — those parts of the prompt check out, and the tombstone design is right.
- There is no user-facing "Delete my account" anywhere. That, not the tombstone, is what App Store guideline 5.1.1(v) and Play's data-deletion policy actually require.

So: deletion flow first, tombstones as one component of it.

## Deletion rules (the part that needs your sign-off)

| Role | What is deleted | What is retained |
| --- | --- | --- |
| Coach | Auth user, email, name, Stripe subscription cancelled, uploaded resources, voice notes | Plans, moves, lesson history, invoices — de-identified, attributed to "A former coach". Matches privacy policy §7. |
| Parent | Auth user, profile row, name/email, Stripe subscription cancelled | Nothing personal. Their messages tombstone. |
| Adult athlete | Auth user, athlete row, goals, session logs, voice notes | Coach-authored plans stay with the coach, athlete link nulled. |
| Minor athlete's parent | Parent account **and** each athlete they solely guardian (no remaining co-guardian) | If a co-guardian remains, athletes transfer to them and survive. |

Grace period: none — deletion is immediate and irreversible, with typed-email confirmation. Both stores accept immediate; a delayed queue adds a whole recovery surface we don't need.

## Build order

**1. Schema — make deletion survivable**

- `coach_profiles.user_id` → nullable, FK `ON DELETE SET NULL`. The coach row (and everything hanging off it) survives; identity fields are blanked by the deletion function. All RLS helpers compare `cp.user_id = auth.uid()`, which simply stops matching — no policy edits needed.
- `direct_rooms.parent_id`, `coach_id`, `coach_a_id`, `coach_b_id` → `ON DELETE SET NULL` (all four, not just `parent_id`). `is_direct_room_participant` matches on `user_a`/`user_b`, which are bare uuids, so the surviving party keeps access.
- `athletes.parent_id` already `SET NULL`; confirm and leave.
- New `deleted_accounts` audit table: `user_id`, `role`, `deleted_at`, `initiated_by` (`self` | `admin`), `email_hash`. No plaintext email. GRANTs + RLS: admin-read only.

**2. Schema — message tombstones** (Claude's Step 1, accepted essentially as written)

- `messages.sender_user_id` → nullable, FK to `auth.users` `ON DELETE SET NULL`, `NOT VALID`.
- Add `messages.sender_deleted_at timestamptz`.
- `BEFORE UPDATE OF sender_user_id` trigger that clears `body` to `''`, nulls `audio_url` / `duration_seconds`, stamps `sender_deleted_at`. Keeping this in a trigger rather than app code is correct — it covers cascades and admin SQL too.
- No RLS changes, no row deletions, `body` stays `NOT NULL`.

**3. `deleteMyAccount` server function**

Authenticated, requires the caller to retype their own email. Ordered steps, each idempotent:
1. Cancel any Stripe subscription (`openExternal` is irrelevant here — this is server-side API).
2. Delete the caller's objects from the `voice-notes` bucket and, for coaches, their `resources` uploads. This closes the gap Claude flagged as out of scope — it belongs here, in the same commit, or signed URLs keep resolving.
3. Role-specific cleanup per the table above (blank coach identity fields; delete parent/athlete rows; transfer or delete minors).
4. Write the `deleted_accounts` audit row.
5. `supabaseAdmin.auth.admin.deleteUser(...)` last, so the cascades in step 1 fire against an already-cleaned graph and messages tombstone.

Admin's existing soft-delete stays as-is — it's a moderation tool, not a deletion tool. I'll add an admin **hard**-delete that calls the same code path.

**4. UI — delete my account**

A destructive row in `src/components/settings/account-security-section.tsx` for all three roles, opening an `AlertDialog` (the only overlay allowed for destructive confirms) that: states exactly what is deleted and what is retained, warns about active subscriptions and co-guardians, requires the typed email, then signs out to `/`.

**5. UI + logic — tombstoned messages**

- `MessageDTO.senderUserId` → `string | null`, add `senderDeletedAt: string | null`; same for the hand-declared row types and both `select` lists in `messages.functions.ts`.
- Fix the sender lookup: when `sender_user_id` is null, skip participant matching entirely. Claude is right that `null === null` currently makes a tombstone match any de-identified participant.
- Unread: I'm **not** taking Claude's "keep tombstones unread-eligible". Simpler and safer — treat a tombstoned message as never-unread in both `markRoomRead` and `getUnreadTotal`. A deleted person's blanked message shouldn't produce a badge, and it removes the stuck-badge class of bug rather than re-synchronising two filters that already drifted once.
- Render per your choice: role kept, name dropped — `Coach (deleted account)` on the sender line, muted italic *Message deleted* in the bubble for both text and voice. Same label in `room-list.tsx` previews.
- Skip null senders in `admin-activity.server.ts` and `admin.functions.ts` rollups; add `sender_deleted_at` to `admin-ask-schema.server.ts`.

**6. Verify**

Seed coach + parent + athlete with text and voice in both an athlete room and a coach↔parent DM; delete each role in turn; confirm the thread survives every time with only that person's rows blanked, the room renders for the others, the unread badge settles at zero, the storage objects are gone, and `bun run lint` is clean.

## Not in scope

`privacy.tsx` is untouched — it mirrors the published policy and only counsel changes that. Worth flagging: §7 promises coach identity is "deleted or de-identified within a reasonable period", which this implements, but it says nothing about message retention. You may want counsel to add a line about tombstoned messages in shared threads.
