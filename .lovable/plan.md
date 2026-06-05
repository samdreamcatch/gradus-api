## Pre-lesson briefing for the "up next" athlete

A new card pinned above the schedule on the Schedule tab of `/coach/roster`. It only appears when there is an upcoming lesson today within the next ~2 hours. It surfaces the same practice metadata that already appears on the schedule row plus a short AI-written paragraph about what the athlete has been up to since the last lesson.

### When it appears
- Schedule tab only, when there is at least one of the coach's lessons happening today whose end time has not yet passed and whose start is within the next 2 hours.
- Targets exactly one athlete — the next chronologically.
- If no lesson qualifies, the card is hidden entirely (no placeholder).

### What it shows
A single rounded `bg-card` card above the date strip with:

1. **Header row:** athlete name + start time ("Beverly Cleaver · 11:00 AM").
2. **Metadata strip** (re-uses existing data, no recomputation):
   - "Since last" hours + weekly goal + status chip (Behind / Light / On track / Over target).
   - Flow-state dots (same up-to-7 reversed series the schedule row already shows).
3. **AI narrative paragraph (2–4 sentences):**
   - What this athlete has worked on in *this coach's* active/recent plans since the last lesson.
   - Parallel work in other coaches' active plans for the same athlete.
   - Practice-log activity across all coaches: cadence, dominant moves, last logged date.
   - Notable signals from recent messages in this coach's room with the athlete/parent (e.g. "Mom mentioned a sore ankle Tuesday").
4. **Subtle "Refresh briefing" affordance** (icon button) to force-regenerate if the coach wants a new take.

### AI narrative generation
- Model: `google/gemini-3-flash-preview`.
- Generated via a `createServerFn` (`getPreLessonBriefing`).
- **Cached** in a new `pre_lesson_briefings` table keyed by `(coach_id, athlete_id, lesson_date)`. Each row stores: the narrative text, a `source_hash` of the inputs, and `generated_at`.
- On call:
  1. Gather inputs (see below) and compute `source_hash` (stable JSON of plan IDs+updated_at, latest practice-log IDs+created_at, last N message IDs+created_at).
  2. If a cached row exists with matching hash → return it.
  3. Otherwise call Lovable AI, upsert the row, return the new narrative.
- "Refresh briefing" bypasses the hash check.

### Data inputs the server fn gathers
For the chosen athlete:
- **This coach's plans:** active plan + any plan_moves updated since the previous lesson_date.
- **Other coaches' plans** (read via `supabaseAdmin` inside the handler, scoped only to coaches who are linked to this athlete in `coach_athletes`): active plan name, sport, status, last `updated_at`. No move-level detail.
- **Practice logs** for this athlete across all coaches: rows since the previous lesson, with their per-session `flow_state` if present and the moves practiced.
- **Messages**: last ~10 messages in this coach's `message_rooms` row with this athlete/parent since the previous lesson.
- **Last lesson date** for this coach + athlete: most recent past slot from `athlete_lesson_slots`.

### Technical details (for reference)

**New table** (`pre_lesson_briefings`):
- `id uuid pk`
- `coach_id uuid` → `coach_profiles.id`
- `athlete_id uuid` → `athletes.id`
- `lesson_date date`
- `narrative text`
- `source_hash text`
- `generated_at timestamptz default now()`
- Unique on `(coach_id, athlete_id, lesson_date)`.
- RLS: coach can select rows where `coach_id` belongs to their `coach_profile`. Writes via `supabaseAdmin` only.
- Grants: `SELECT` to `authenticated`; `ALL` to `service_role`.

**New server fn** `src/lib/pre-lesson-briefing.functions.ts`:
- `getPreLessonBriefing({ athleteId, lessonDate })` with `requireSupabaseAuth`.
- Verifies the caller is the coach linked to the athlete.
- Returns `{ narrative, generatedAt, fromCache }`.
- Calls Lovable AI Gateway via the existing `src/lib/ai-gateway.server.ts` helper.

**Schedule integration** (`src/routes/_authenticated/coach.roster.tsx` + `week-schedule-view.tsx`):
- Compute "next upcoming session today within 2h" from existing `selectedSessions`.
- Render a new `<PreLessonBriefing athleteId lessonDate startMinute />` component above the day's session list when Schedule tab is active and a match exists.

### Out of scope
- Messages from other coaches' rooms (kept private).
- Push/email notifications.
- Editing the generated narrative.
- A briefing for sessions further out than 2 hours, or for past sessions.
