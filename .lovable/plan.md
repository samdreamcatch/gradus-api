# Org Admin: club content (Stage 1 of 3)

Build the Organization Admin pages in stages, so each one can be tested in the preview with Buddy Garrity (Test Club).

- **Stage 1 (this plan):** club sports, Resource library, Move library, Levels
- **Stage 2:** Template plans, made one at a time or in bulk from a CSV, sent to coaches by sport and level
- **Stage 3:** Resource builder (branded PDFs written with AI)

## Decisions
- **Which sports a club has:** a Gradus admin sets them for each club in Internal Admin, in Organizations & codes. Every org admin page shows only those sports.
- **Club edits replace defaults:** if the club edits or archives a move or resource, its coaches see the club's version. Archived items disappear for them.
- **Levels are defaults:** coaches in the club start with the club's levels and practice hours, and can still change their own practice hours.

## What the org admin gets

**Resource library** (`/org-admin/resources`)
- A sport switcher showing what coaches see today: the Gradus library plus any club resources.
- For each resource: Edit (title, description, file or link), Archive / Restore, and a "Club" or "Gradus" label.
- Add one resource: upload a PDF or paste a link.
- Bulk upload: pick several PDFs, choose a sport for each, and add them all at once.
- Club uploads go through the same picture check coaches' uploads do.
- **Require acknowledgement** (for policies): on any club resource, turn on "Require acknowledgement" and pick who must acknowledge it. That can be coaches, parents, athletes, or any mix.
  - The people chosen get a push notification, plus an in-app banner if they have no app, with an "I acknowledge" button on the document.
  - Each acknowledgement is stored with the person's name, role, the date and time, and the version of the document they saw.
  - The admin sees a sign-off list for each document: who acknowledged it, who is still outstanding, and a CSV export. A "Remind outstanding" button sends the notification again.
  - Replacing the file makes a new version. Earlier sign-offs are kept in the history, and you can choose to ask everyone to acknowledge again.
  - Under-18 athletes: their parent or guardian acknowledges for them, unless you'd like athletes to acknowledge it themselves too.

**Move library** (`/org-admin/moves`)
- Gradus default moves for each club sport, in a table grouped by category, with search.
- Edit one move (name, cue, why, default target) in a side sheet. This makes a club version of the move.
- Bulk edit: select rows, then change the category or target, or archive / restore them.
- Bulk upload from a CSV, using the same import and name-matching as coaches' imports, with a preview before saving.

**Levels** (new sidebar item, `/org-admin/levels`)
- For each club sport: the level ladder with practice hours per week for each level.
- Add custom club levels, rename them, reorder them and archive them.
- New coaches in the club start with these. Existing coaches get them when they haven't set their own hours.

**How coaches see changes:** each save bumps the club's content version. Coaches' libraries and level pickers then read club content first, then Gradus defaults, and leave out anything the club archived.

## Look and feel
Only existing parts: PageTitle, Card, Table, Sheet for editing, AlertDialog for archiving, Eyebrow, Button with `press`, sonner toasts. Semantic colors only, with the pen color used for "Club" labels. No plain Dialog and no hover effects.

## Technical details
- **New tables:**
  - `organization_sports(org_id, sport)`: Gradus admins write it, org admins read it.
  - `org_resource_overrides` and `org_move_overrides`: (org_id, base id, archived_at, edited fields) for the club's versions of Gradus items. Club-made items reuse the existing `organization_id` and `is_org_template` columns on resources and moves.
  - `org_levels(org_id, sport, level_key, label, sort, practice_hours_per_week, archived_at)`
  - `resource_ack_requirements(resource_id, org_id, audiences text[], version, required_at)` and `resource_acknowledgements(resource_id, version, user_id, role, acted_for_athlete_id, acknowledged_at)`:
    - Rows can only be added; nobody can edit or delete them.
    - A person can insert only their own acknowledgement, and only when they are in the required audience for that club.
    - Org admins read their club's rows.
    - Push goes through the existing `push-notify.server.ts`.
  - Each table gets GRANTs and RLS using `has_org_admin(auth.uid(), org_id)` for writes and club-member reads.
- **Server functions:** a new file, `src/lib/org-content.functions.ts`, holds the list, upsert, archive and bulk functions. Each checks `has_org_admin` through `context.supabase` before any privileged write, and bumps `organizations.content_version`.
- **Coaches' reads:** `coach-resources.server.ts`, `moves.server.ts` and the coach level lookup merge club content in this order: club override, then club item, then Gradus default.
- **Admin side:** a sports multi-select on the admin organizations page.
- **Bulk uploads:** CSV parsing reuses `moves-import.server.ts`. Bulk PDFs reuse the signed-upload flow already used for coach resources.
- **Checks:** tests for the merge rules and permissions (non-admins rejected), then lint, typecheck and build. Then a walk-through in the browser as Buddy Garrity.
