# Make inviting students and parents a main action

## Goal
Make "add students and invite their families" the main club-admin action. It should feel like adding a student in the coach iOS app, but faster on a desktop. Club admins can add brand-new students for any seated coach.

## Where it lives
- **Users → Students & families** (new tab next to Coaches). One table of every student across the club: student, under/over 18, parent or guardian, email, coach(es), lessons, invite status (Not invited / Invited / Joined / Missing email).
- A main **Add students** button at the top of the tab.
- Schedule keeps a small "Invite" shortcut that opens the same Add students sheet. The buried "Send invites · N" chip becomes a clear banner instead: "3 students haven't been invited — Review".

## Add students sheet (wide side panel)
The same fields as iOS, laid out as editable rows so an admin can enter many students in one pass:
1. **Coach** picker at the top (only seated coaches). It applies to every row, and each row can override it.
2. **Rows**, one per student: First / Last name, Under 18 / Over 18 toggle, then either the parent or guardian's name and email (under 18) or the athlete's email (over 18), Day, Start, Length (one menu: 30/45/60/90/Other — option A from the mockups), Frequency.
3. **Starting levels** (optional, closed by default): "Add levels" opens Current level and Season target for the coach's sport. The parent later sees these as the coach's suggestion.
4. **Desktop speed-ups**
   - Tab and Enter move between cells; Enter on the last row adds a new row.
   - Paste several rows straight from a spreadsheet; the columns fill automatically.
   - "Import a file" (CSV, or a photo of a written schedule, like iOS) fills the same rows for review.
   - Duplicate row; "apply to all" for coach, length and frequency.
   - Each row is checked as you type: a missing email, a duplicate student, or the coach's roster being full shows on that row (Skip / Include anyway, like iOS).
5. **Send invites now** checkbox, on by default. Footer: "Add 5 students · send 5 invites". This always asks for confirmation first.

## Result screen
The same layout as iOS "Import complete": a ✓ row for each student added and each invite sent, and a ! row for anything skipped, with the reason. Skipped rows can be fixed and retried without starting over.

## Rules
- Club admins can add new students only to coaches who hold a seat in the club. The student goes on that coach's roster.
- Coach roster limits still apply. A full roster is flagged on its row; nothing goes over the limit without being flagged.
- Under-18 students always join through a parent or guardian (the same as iOS). Invites use the existing parent and athlete invite emails and 8-character codes.
- No emails go out while I test. I'll check sending on a test club only after you OK it.
- iOS and Android sign-up stay unchanged.

## Technical details
- New authorized server function `clubAddStudents` (club-admin check → service RPC `club_add_students`, one transaction, idempotent request key). It creates `athletes` plus `coach_athletes` links, guardian invite codes or adult-athlete invite codes, optional `athlete_lesson_slots`, and an optional first `athlete_goals` row marked as a coach suggestion. Rows return one by one as added, skipped or failed. Every action is logged to `org_admin_actions`.
- Pure, tested row validation in `src/lib/club-add-students.ts`: under/over-18 email rules, duplicates, roster capacity, paste parsing and length "Other".
- Students & families DTO reuses the Schedule/roster data (no second contact list) and is club-scoped.
- The sheet reuses the existing Sheet, ClubTable, Select and Tabs components. No new design primitives.
- Invite sending reuses the existing guardian/adult invite email path behind a confirmation.
- Tests cover: blocking seatless coaches, the under-18 parent-email requirement, the roster-cap flag, and that a retry doesn't add the same student twice.
