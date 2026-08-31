# Report & block users

Google Play's user-generated content policy requires three things for any app with
in-app messaging: an in-app way to **report** objectionable content and users, an
in-app way to **block** a user, and a visible commitment to act on reports. Right
now Gradus has messaging with no reporting or blocking path at all.

## Where it goes (and why there)

Messaging is the primary surface, but Play expects the controls to be reachable
wherever a person appears — not just inside one thread.

1. **Conversation header** (`room-view.tsx`) — an overflow "⋯" trigger next to the
   participant names opens a Popover with **Report** and **Block**. This is the
   universal messaging pattern and is where reviewers look first.
2. **Per-message** — long-press (touch) / right-click (desktop) on any message
   bubble opens the same Popover scoped to that message, pre-filling the report
   with the message ID so the offending content itself is flagged in context.
3. **Person detail pages** — the coach detail / athlete detail / connection rows
   that already have connect-disconnect actions gain a "Report or block" row in
   their existing action list.
4. **Settings → Account & security** — a **Blocked users** row (same style as the
   existing rows there) listing everyone you've blocked, with Unblock. Play wants
   block to be reversible and discoverable outside the thread.
5. **Legal section** — a one-line statement that reports are reviewed within 24
   hours, since the store listing and policy page are also checked.

No new UI primitives: Popover, Sheet, AlertDialog, Textarea, and the existing
settings row components cover all of it.

## What "block" does

Full disconnect, as decided:

- Messaging stops in both directions and existing shared rooms are hidden for both
  parties (history preserved, not deleted).
- Any coach-athlete / coach-parent / coach-coach link between the two is severed,
  the same way the existing disconnect action works.
- Guardian email mirroring for that pair stops.
- Blocking is confirmed with an AlertDialog spelling out that the coaching
  connection will be removed — this is destructive and worth a hard confirm.
- Unblocking from settings restores messaging ability but does **not** silently
  re-create the coaching link; they reconnect normally.

## Reporting flow

A Sheet with a required reason (Harassment or bullying / Inappropriate or sexual
content / Spam or scam / Safety concern about a minor / Other), an optional
free-text note, and a "Also block this person" checkbox that is checked by default.
On submit: report stored, confirmation toast, and — a Play requirement — the
reporter never sees whether action was taken on the other account.

Reports land in **both** places: stored in the database and emailed to the Gradus
inbox immediately, plus a new **Trust & safety → Reports** section in the admin
sidebar with a triage queue (open / reviewed / actioned / dismissed), the reported
message context, and links to both users' admin profiles. Safety concerns about a
minor are flagged at the top of the queue.

## Technical notes

Database migration (one migration, with GRANTs and RLS in the same file):

- `user_blocks` — `blocker_user_id`, `blocked_user_id`, `created_at`, unique pair.
  Authenticated users read and write only rows where they are the blocker;
  `service_role` full. A security-definer `public.users_blocked(a, b)` helper
  returns true if a block exists in either direction, so message RLS and room
  listing can use it without recursive policy problems.
- `user_reports` — `reporter_user_id`, `reported_user_id`, `message_id` (nullable,
  `ON DELETE SET NULL`), `reason`, `note`, `status`, `created_at`, `updated_at`
  with the standard update trigger. Reporters may insert and read their own;
  admins read and update all via `has_role`.

Server functions in a new `src/lib/safety.functions.ts`, all under
`requireSupabaseAuth`:

- `submitReport` — validates reason, inserts, sends the admin email through the
  existing transactional email path, optionally calls the block path.
- `blockUser` / `unblockUser` — block reuses the existing disconnect logic in
  `coach-athlete` / visibility code rather than duplicating it.
- `listMyBlocks`, and admin-side `adminListReports` / `adminUpdateReportStatus`
  (role-checked, in `admin.functions.ts` alongside the existing admin fns).

Messaging changes: `listMyRooms` and `getRoom` filter out rooms whose other
participant is blocked in either direction; `sendMessage` rejects a send into a
blocked pair; `new-conversation-button` omits blocked people from targets.
Guardian mirroring in `guardian.server.ts` skips blocked pairs.

Files touched: `src/components/messages/room-view.tsx`,
`new-conversation-button.tsx`, `room-list.tsx`, `src/lib/messages.functions.ts`,
`src/lib/guardian.server.ts`, `src/components/admin/admin-sidebar.tsx`, a new
`src/routes/_authenticated/admin.reports.tsx`, a new
`src/components/safety/report-sheet.tsx` + `block-confirm.tsx`, the three
`*/settings/account` sub-pages, and `src/components/settings/legal-section.tsx`.

No changes to message RLS SELECT semantics for existing rows, no message deletion,
and `src/routes/privacy.tsx` stays untouched. Verify with Prettier,
`bunx tsgo --noEmit`, `bun run lint`, and a preview pass of a thread, the report
sheet, block confirm, blocked-users list, and the admin queue.
