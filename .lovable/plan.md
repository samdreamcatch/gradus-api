## Goals

Make `/coach/settings`, `/parent/settings`, `/athlete/settings` feel like a consumer app settings page — tight rows, collapsible sections, dividers instead of giant cards. Reuse the visual language of `/coach/plans` (the move library) where it fits.

## Visual system (shared)

A new shared primitive `src/components/settings/` set:

- `SettingsList` — rounded-2xl container, `bg-card`, `divide-y divide-divider`. No internal padding; rows manage their own.
- `SettingsRow` — single row, `px-4 py-3`, leading icon (optional, lucide), label on the left, value/control on the right, chevron when it opens a sheet, no inner shadows. Hover: `bg-elevated/60`.
- `SettingsGroup` — small uppercase label above a `SettingsList` (`text-[11px] font-bold uppercase tracking-widest text-text-tertiary mb-2`).
- `SettingsDisclosure` — `SettingsRow` whose body expands inline via `@/components/ui/collapsible` (chevron rotates). Body is `px-4 pb-4` and contains the existing forms.
- `SettingsToggleRow` — row with a `Switch` on the right.
- Page chrome: `max-w-2xl mx-auto px-3 pt-4 pb-24`, sticky header bar `h-12` with the page title (matching the plans tab header density).

All colors stay token-based. No new tailwind colors.

## Coach settings (`/coach/settings`)

Replace the current card-per-section layout with one `SettingsList` per group:

1. **My profile** — disclosure rows:
   - First name, Last name (inline edit)
   - Email — read-only row showing `auth.user.email`
2. **Sports** — disclosure that contains the existing `LevelsSection` + `PracticeSection` UI, but rendered as compact rows (sport name as row title, expand to reveal level checkboxes and hours).
3. **Invite parents** — row with the current invite code as the right-aligned value and a chevron that opens a small sheet/disclosure with the existing `InviteCard`.
4. **Notification preferences** — section omitted per user.
5. **Appearance** — row with a segmented `Light / Dark / System` control (sub-component `ThemeSelect`).
6. **Sign out** — full-width destructive-tinted ghost row at the bottom, separated by spacing.

## Parent settings (`/parent/settings`)

1. **My profile** — first/last name inline, email read-only.
2. **My athletes** — `SettingsList` of one disclosure per athlete:
   - Header row: name + sport summary, chevron
   - Body: identity (name + birthdate), goals (`AthleteGoalsForm`), schedule (`ScheduleEditor`), coaches assigned (multi-select from parent's connected coaches), invite code row (chevron opens QR), and `Remove` at the bottom (kept gated against removing the last athlete).
   - Footer row: `+ Add an athlete`.
3. **Connect a coach** (new) — list of currently connected coaches with a "Primary" pill on one and a star toggle to change primary; row to enter a new invite code (`+ Add coach`). Removing a coach prompts confirmation and detaches them from all athletes.
4. **Notification preferences** — omitted.
5. **Appearance** — same theme row.
6. **Sign out**.

## Athlete settings (`/athlete/settings`)

Mirror the same primitives:

1. **My profile** — first/last name, birthdate, email read-only.
2. **Appearance** — theme row.
3. **Sign out**.

(Notifications skipped here too for consistency.)

## Theme system

- Add `src/components/theme-provider.tsx`: wraps app, manages `light | dark | system`, persists to `localStorage("theme")`, toggles the `dark` class on `<html>`, listens to `prefers-color-scheme` when `system`.
- Mount in `src/routes/__root.tsx` inside the existing providers.
- Add a `:root` (light) token block in `src/styles.css` mirroring the existing dark tokens so all `oklch` tokens have a light counterpart. Dark stays under `.dark`.
- `ThemeSelect` is a 3-segment toggle using `@/components/ui/toggle-group`, no extra deps.

## Multi-coach data model

New join table `public.parent_coaches`:

```text
parent_id uuid → parent_profiles.id  (cascade)
coach_id  uuid → coach_profiles.id   (cascade)
is_primary boolean default false
created_at, updated_at
PRIMARY KEY (parent_id, coach_id)
Partial unique index: (parent_id) WHERE is_primary  -- one primary max
```

Migration also:
- Backfills rows from existing `parent_profiles.coach_id` with `is_primary = true`.
- Adds standard `GRANT` for `authenticated` + `service_role`.
- RLS: parent can CRUD their own rows; coach can `SELECT` rows where `coach_id` matches their `coach_profiles.id`.
- Keeps `parent_profiles.coach_id` for now (still used elsewhere), and a trigger keeps it in sync with the primary `parent_coaches` row so existing reads continue to work. A follow-up can remove the column once call sites are migrated.

Server functions added to `src/lib/parent-settings.functions.ts`:
- `listParentCoaches`
- `addParentCoachByInvite({ code })` — reuses existing coach-invite lookup; refuses duplicates; first coach added auto-marked primary.
- `setPrimaryCoach({ coachId })`
- `removeParentCoach({ coachId })` — refuses if it's the only coach; clears that coach from any `coach_athletes` rows under this parent.
- `setAthleteCoaches({ athleteId, coachIds })` — rewrites `coach_athletes` for that athlete restricted to the parent's connected coaches.

`getParentSettings` extended to return `coaches: [{ id, name, isPrimary }]` and each athlete's `coachIds`.

## Files touched

New:
- `src/components/settings/settings-list.tsx`, `settings-row.tsx`, `settings-group.tsx`, `settings-disclosure.tsx`, `settings-toggle-row.tsx`, `theme-select.tsx`
- `src/components/theme-provider.tsx`
- `src/components/settings/coach-section.tsx` (parent-side multi-coach UI)
- `supabase` migration for `parent_coaches`

Edited:
- `src/routes/__root.tsx` — wrap in `ThemeProvider`
- `src/styles.css` — add `:root` light tokens
- `src/routes/_authenticated/coach.settings.tsx` — rewrite layout using new primitives; keep existing form logic
- `src/routes/_authenticated/parent.settings.tsx` — rewrite layout; add Connect-a-coach section; add per-athlete coach assignment
- `src/routes/_authenticated/athlete.settings.tsx` — rewrite layout; add email row + theme row
- `src/lib/parent-settings.functions.ts` — new server fns above; extend `getParentSettings`

## Out of scope

- Notification preferences (skipped).
- Phone field (removed from requirements).
- Email change flow (read-only only).
- Removing `parent_profiles.coach_id` column (kept in sync via trigger; cleanup is a separate task).
