# Team Plan: rename Family, plus coach-to-coach visibility

Two changes shipped together: the Family plan becomes the **Team plan** everywhere (including
route and internals), and the Team plan gains a second benefit — the parent can let an athlete's
coaches see one another and each other's work for that athlete.

## Part 1 — Rename Family to Team

Full rename, internals included:

- Route `/parent/family` becomes `/parent/team`. The old path stays as a redirect so live invite
  links and bookmarks keep working.
- All UI copy, page titles/meta, emails ("Family invite" template), and toasts say "Team plan".
- Code files rename: `family-guardians.functions.ts` → `team-guardians.functions.ts`,
  `family.server.ts` → `team.server.ts`, `family-emails.server.ts` → `team-emails.server.ts`,
  `family-invite` email template → `team-invite`, `parent.family.tsx` → `parent.team.tsx`,
  plus function names (`getFamilyPlanStatus` → `getTeamPlanStatus`, etc.) and query keys.
- Database: `parent_profiles.family_plan_seats` → `team_plan_seats`.
- Stripe: product/price display names change to "Gradus Team plan"; internal price keys become
  `team_monthly` / `team_yearly`. New subscriptions stamp `metadata.plan = "team"`; existing
  subscriptions carrying `metadata.plan = "family"` are still recognised as active Team plans, so
  no current subscriber is disrupted.
- The claim route `/family/$token` keeps working and a `/team/$token` alias is added.

## Part 2 — Coach visibility (Team plan benefit)

### What the parent does

On `/parent/team`, below the guardians section, a new **Coach visibility** section lists each
athlete with their connected coaches and a switch per coach.

- Switching a coach on means "this coach may share with my athlete's other shared coaches."
- Visibility is always two-way: any two coaches who are both switched on for the same athlete
  form a link. There is no one-way window.
- Each link starts as **Pending** until both coaches accept. States shown next to each coach:
  Off, Pending (waiting on a coach), Connected, Declined.
- Switching a coach off immediately closes every link that coach had for that athlete.
- Section is visible only on an active Team plan; free parents see the same locked row pattern
  already used for guardians, routing into checkout.

### What the coach does

Each affected coach gets an email ("A parent connected you with another coach") and a pending
item in coach settings under the existing Connections hub: *Coach name — for Athlete name*, with
Accept and Decline. Nothing is shared until they accept. Declining is silent to the other coach
(the parent sees "Declined").

### What connected coaches get

For that athlete only, full club-style parity, read-only:

- Each other's plans for the athlete and the practice log on those plans
- The athlete's goals and lesson schedule
- Direct messaging between the two coaches (the coach-to-coach DM already exists app-wide; this
  just surfaces the other coach on the athlete's detail page as a shared coach)

Coaches can never edit another coach's plan, and visibility never extends to the coach's other
athletes.

## Technical notes

**Schema.**
- `public.athlete_coach_visibility (id, athlete_id, coach_id, enabled_by_parent_id, created_at)` —
  the parent's per-coach opt-in.
- `public.coach_visibility_links (id, athlete_id, coach_a_id, coach_b_id, a_status, b_status,
  created_at, updated_at)` with statuses `pending|accepted|declined` and a unique index on
  ordered `(athlete_id, coach_a_id, coach_b_id)`. A link is active when both statuses are
  `accepted` and both coaches still hold an opt-in row.
- GRANTs plus RLS on both tables in the same migration: parents read/write rows for athletes they
  can access (via the existing `parent_athlete_ids()` helper) and only while the household Team
  plan is active; coaches read links naming them and update only their own side's status.

**Access.** New SECURITY DEFINER helper `public.coaches_linked_for_athlete(_viewer_coach_id,
_owner_coach_id, _athlete_id) returns boolean`. Added as an extra permissive SELECT policy on
`plans`, `plan_moves`, `plan_sessions`, `athlete_goals`, and `athlete_lesson_slots` — additive
only, no existing policy is modified. Writes are untouched, so read-only is enforced in the
database, not just the UI.

**Server functions.** New `src/lib/coach-visibility.functions.ts`:
`listAthleteCoachVisibility`, `setCoachVisibility` (parent, Team-plan gated, creates/closes links
and queues coach emails), `listPendingCoachLinks` and `respondToCoachLink` (coach side).
Parent-side gating reuses the existing Team-plan status check; coach reads reuse the roster
ownership checks in the coach functions.

**UI reuse.** Parent side uses `SettingsGroup` / `SettingsList` / `SettingsRow` with the existing
Switch, matching the guardians section. Coach side reuses the Connections hub sheet in
`coach.settings.tsx` and its row pattern. Shared plans on the coach athlete detail page reuse the
existing "from <coach>" attribution badge already used for Gradus starter plans, with an inline
read-only marker. No new components or design tokens.

**Email.** New `team-coach-link` template registered in the email registry and admin copy schema,
following the existing `family-invite` pattern, sent through the existing queue.

## Build order

1. Rename migration + code/route/copy rename, with Stripe metadata back-compat and redirects.
2. Visibility schema, helpers, RLS, grants.
3. Server functions for parent toggles and coach accept/decline.
4. Parent `/parent/team` Coach visibility section.
5. Coach pending-link UI + email template.
6. Read-only shared plans/goals/schedule surfacing on the coach athlete detail page.
