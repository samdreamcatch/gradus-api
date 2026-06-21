
## Feedback feature

A jelly-pen FAB on every authenticated page lets users send quick feedback. Each entry auto-captures page, role, and device info, and shows up in a new Feedback tab in admin.

### User experience

- **Floating button**: small circular pen-accent FAB anchored bottom-right, sitting above the bottom nav on coach/parent/athlete layouts. Uses `MessageSquarePlus` icon + `shadow-card`. Tooltip "Send feedback".
- **Sheet** (mobile: bottom Sheet, desktop: Dialog) titled "Send feedback" with:
  - Type chips: Bug · Idea · Praise · Other (single select, default Idea)
  - Message textarea (required, max 2000 chars), placeholder "What's on your mind?"
  - Tiny footer line: "We'll know which page you're on and your device." (transparency)
  - Submit button "Send" → toast "Thanks — got it." then closes
- Styling follows existing patterns (`session-feedback-modal.tsx` as reference: Fraunces display title, accent submit button, divider borders).

### Data captured

User-entered: `type`, `message`.
Auto: `user_id`, `role` (coach/parent/athlete/admin), `path` (`window.location.pathname + search`), `user_agent`, `viewport` (`${w}x${h}`), `created_at`.

### Schema

New table `public.feedback`:
- `id uuid pk default gen_random_uuid()`
- `user_id uuid not null` (no FK to auth.users)
- `role text not null check in ('coach','parent','athlete','admin','unknown')`
- `type text not null check in ('bug','idea','praise','other')`
- `message text not null check (length(message) between 1 and 2000)`
- `path text`, `user_agent text`, `viewport text`
- `created_at timestamptz default now()`
- `resolved_at timestamptz` (admin can mark handled later)

GRANTs: `INSERT` to authenticated; `SELECT/UPDATE` gated by admin via RLS using `has_role(auth.uid(),'admin')`. Service role full. Index on `created_at desc`, `user_id`.

### Server functions (`src/lib/feedback.functions.ts`)

- `submitFeedback` — `requireSupabaseAuth`, validates `{type, message, path, userAgent, viewport}` with zod, derives role by checking coach_profiles/parent_profiles/athletes for `userId`, inserts row.
- `listFeedback` — admin-only (checks `has_role`), returns recent feedback joined with user display name + test flag; supports filter by `type` and `unresolved`.
- `setFeedbackResolved` — admin-only, toggles `resolved_at`.

### UI placement

- New component `src/components/feedback/feedback-fab.tsx` (FAB + sheet) mounted once inside `src/routes/_authenticated.tsx` so it appears on every signed-in route. Hidden on admin routes if desired (keep visible — admins can dogfood).
- New admin route `src/routes/_authenticated/admin.feedback.tsx`: list view with type filter chips, unresolved toggle, rows showing user name + role + test badge, type pill, time-ago, page path (mono), and expandable message. Click row to mark resolved.
- Add "Feedback" tab to admin nav alongside existing Overview / Lists tabs in `admin.tsx`.

### Out of scope (call out)

No screenshot upload, no sentiment scale, no email notifications. Easy to add later.
