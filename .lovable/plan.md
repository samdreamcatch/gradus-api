
# Organization Admin Portal

A new portal at `/org-admin` that mirrors the Internal Admin (`/admin`) layout — same `Sidebar` chrome, `Eyebrow`, tables, sheets, dialogs. Header reads "Organization Admin" instead of "Internal". Scoped to a single organization; every read/write is gated by `has_org_admin(auth.uid(), org_id)`.

## 1. Data model & access

**New: org admin membership**
- `public.org_admins (id, organization_id, user_id, created_by, created_at)`
- Non-coach admins are allowed — no `coach_profiles` row required. Signup for these is by invite-only (magic link).
- New `has_org_admin(_user_id, _org_id)` SECURITY DEFINER function; new `is_any_org_admin(_user_id)` for gate.
- Extend `getMyRole` so a user with only `org_admins` rows resolves to `role: 'org_admin'` and routes to `/org-admin`.

**Coach invites (org-issued)**
- `public.org_coach_invites (id, organization_id, email nullable, phone nullable, invite_token, invite_code, status enum(pending|accepted|revoked), invited_by, created_at, accepted_at, accepted_user_id)`
- Delivery: reuse the existing auth-email template pipeline for magic-link email; SMS via existing Twilio path (`TWILIO_FROM_NUMBER` secret already present) with a short code link `/i/<code>`. Coach onboarding auto-attaches to the org and skips the paywall (Club tier).

**Roster & counts**
- Roster = `coach_profiles.organization_id = <org>`. "Pending" = matching `org_coach_invites.status = 'pending'` with no accepted user.
- Athlete/parent counts per coach: existing `coach_athletes` join. Adult (self-managed) athletes counted separately.

**Global library (seed on join, coach owns copy)**
- Add `is_org_template boolean`, `organization_id uuid` to `moves`, `plans` (plans already carry `kind` incl. `template`), and `resources`. Add trigger `validate_org_template_ownership` extended for `resources`.
- On coach join to org: copy org templates into that coach's library (`moves`, `plans` where `kind='template'`, `resources`). Coach owns the copies; edits are local. No propagation after seed.
- Newly created org templates only seed to coaches who join after. Admin UI shows a "Push to existing coaches" action per item that duplicates the row into every current coach's library (skipping name conflicts, logged).

**Removal**
- `removeCoachFromOrg`: clears `coach_profiles.organization_id`, calls existing detach flow (revert to individual plan, stash `WELCOME_BACK` promo). No content stripping. Existing `direct_rooms`, athletes, and library copies remain.

**Club-wide calendar (act as coach)**
- Reuse existing schedule tables. `has_org_admin` gets added to SELECT/INSERT/UPDATE/DELETE policies on `athlete_lesson_slots`, `lesson_slot_overrides`, and `plans` scoped by the coach's org.
- New `billing_events`-style audit table `org_admin_actions (actor_user_id, organization_id, target_coach_id, action, payload jsonb, created_at)` written on any admin-on-behalf mutation.

## 2. Portal structure (mirrors `/admin`)

```text
src/routes/_authenticated/org-admin.tsx           layout + gate (has any org_admin row)
src/routes/_authenticated/org-admin.index.tsx     redirect → /org-admin/roster
src/routes/_authenticated/org-admin.roster.tsx    coach roster + invites
src/routes/_authenticated/org-admin.resources.tsx library defaults
src/routes/_authenticated/org-admin.moves.tsx     move library defaults
src/routes/_authenticated/org-admin.templates.tsx template plans
src/routes/_authenticated/org-admin.calendar.tsx  club-wide calendar
src/routes/_authenticated/org-admin.settings.tsx  org details, invite code, admins list
```

Sidebar built with the same `Sidebar` primitives as `AdminSidebar`. Groups: **Roster**, **Content** (Resources, Moves, Templates), **Schedule**, **Settings**.

## 3. Per-page functionality

**Roster** — table of coaches (name, email, athlete count, parent count, adult-athlete count, joined date, status), plus **Invites** subsection listing pending invites (email/phone, code, sent-at, resend, revoke). Actions: Invite coach sheet (email + optional phone → magic link and/or SMS with `/i/<code>`), Remove (confirm AlertDialog).

**Resources / Moves / Templates** — same UI as coach's existing library screens, but rows are `is_org_template=true, organization_id=<org>`. "Push to existing coaches" bulk action per item. Coaches see these seeded into their libraries on join.

**Calendar** — view all coaches' schedules (filter by coach), create/reschedule/cancel on any coach's behalf. Every write logs to `org_admin_actions`.

**Settings** — org name/logo/city/region (reuse `EditOrgSheet`), invite code (view + rotate), list of org admins (invite another admin by email → magic link, remove admin).

## 4. Signup / invite flow

- Magic-link coach invite: creates row in `org_coach_invites`, sends via existing auth email template (new template "Coach invite to <org>"). Landing route `/i/<code>` accepts the invite, sets `coach_profiles.organization_id`, seeds library, skips paywall.
- Non-coach org admin invite: same shape into `org_admins`; landing sets role, routes to `/org-admin`.
- SMS: uses Twilio; body includes short link to `/i/<code>` and the raw code.

## 5. Design system

Reuse only existing tokens/components: `Sidebar*`, `SidebarInset`, `Eyebrow`, `Card`, `Sheet`, `AlertDialog`, `Popover`, `Button`, `Input`, existing table primitives from `/admin/users`, and existing library sheets (`upload-resource-sheet`, `move-sheet`). No new UI primitives.

## 6. Suggestions I'd flag

1. **Seed-on-join means org edits don't reach existing coaches**. Pair the "Push to existing coaches" button with a per-coach "Reset to org default" action so a coach can voluntarily pull a fresh copy after a name/details edit — otherwise admins have to remember to push every change.
2. **Audit visibility** — surface `org_admin_actions` in an "Activity" tab under Settings so coaches/admins can see who did what on their calendar. Removes the "did admin change my schedule?" support question.
3. **Coach-facing "Club" badge** — mark seeded moves/plans/resources with a small `Club` chip in the coach's library so they know where a default came from, even after they've edited their copy.
4. **Invite expiration** — magic links / codes expire after 14 days; revoke = mark row and reject on `/i/<code>`.
5. **Roster cap for club** stays unlimited (matches existing `roster-limits.ts`).
6. **Deferred**: bulk CSV coach invite, per-coach permissions (admin-only vs coach), and analytics per coach (lesson counts, plan activity) — call out but do not build in this pass.

## Technical notes

- New migration: `org_admins`, `org_coach_invites`, `org_admin_actions`; `is_org_template`/`organization_id` on `resources`; extend `validate_org_template_ownership`; new `has_org_admin`/`is_any_org_admin` SECURITY DEFINER functions; GRANTs + RLS on all three new tables (auth only, gated by `has_org_admin`).
- New server-fn modules: `src/lib/org-admin.functions.ts` (roster CRUD, invites, admin CRUD), `src/lib/org-admin-library.functions.ts` (moves/plans/resources CRUD + push-to-coaches), `src/lib/org-admin-schedule.functions.ts` (act-as-coach schedule ops with audit writes). All use `requireSupabaseAuth` + explicit `has_org_admin` check per call.
- Extend `getMyRole` and `/i/<code>` resolver to handle org invites.
- Reuse existing Stripe flow — no billing changes; org admins do not touch subscription (owner still does that from their coach settings if they're also a coach; otherwise a follow-up will add billing to org-admin settings).
- Zero changes to `/admin` (internal admin) beyond a link on the Organizations page to "View as org admin" for support (impersonation-style, gated to internal admins).
