
## Goal

Give every role a real Settings page reachable from a gear icon at the right edge of the bottom nav. Dashboards collapse to a text-only welcome; everything interactive moves into Settings, alongside fully editable versions of every field captured during onboarding.

## Navigation changes

Per your call: remove "Dashboard" from the bottom nav for all three roles and add a Settings gear (lucide `Settings`) as the rightmost item. Dashboard pages remain at `/parent`, `/athlete`, `/coach` but are no longer linked from the nav (they're just the welcome on first load / logo tap).

New nav order:

- **Parent**: Plans · Messages · Resources · Settings
- **Athlete**: Plans · Messages · Resources · Settings
- **Coach**: Plans · Roster · Messages · Settings

## Dashboard cleanup (becomes text-only)

- `parent.index.tsx`: keep welcome copy + logo. Remove athlete QR/invite cards and Sign out button (both move to Settings).
- `athlete.index.tsx`: keep welcome copy. Remove "View my plans" CTA and Sign out button.
- `coach.index.tsx`: keep welcome heading + sports/levels readout text. Remove the `InviteCard` panel, the "Settings" link button, and Sign out (all move to Settings). Sports/levels stays as a read-only summary since it's purely informational text.

## Settings pages

### `/parent/settings` (new — `parent.settings.tsx`)

Sections, each in the existing `SectionCard` style (rounded-2xl, shadow-card):

1. **Your name** — edit `firstName` / `lastName` on `parent_profiles`.
2. **Athletes** — list each athlete with edit + remove, and an "Add athlete" button. Per athlete (collapsible card):
   - Identity: first/last name, birthdate
   - Goals (current sport, current level, season goal, long-term goal text)
   - Schedule slots (day, start/end time, frequency, weeks-of-month, starts-on) — same control set as `signup.parent.schedule.tsx` extracted into a reusable component.
   - Invite QR / code (the QRCode + copy widget moved from the dashboard).
3. **Account** — Sign out.

### `/athlete/settings` (new — `athlete.settings.tsx`)

1. **Your name** — edit first/last name on `athletes` row tied to `user_id`.
2. **About you** — birthdate (if captured) and any other athlete profile fields available.
3. **Account** — Sign out.

(Athlete onboarding today only captures account + name confirmation, so this page is small by design. Plans access stays in the bottom nav under Plans.)

### `/coach/settings` (already exists)

Add to the existing page:
- **Account** section with Sign out.
Everything else (Name, Sports & levels, Practice expectations, Invite Parents) already lives here — no changes.

## Bottom-nav component changes

Edit `src/components/{parent,athlete,coach}/bottom-nav.tsx`:
- Remove the Dashboard item.
- Append `{ label: "Settings", icon: Settings, to: "/<role>/settings", matchPrefix: "/<role>/settings" }` as the last item.

## Server-fn surface

New `createServerFn` handlers in `src/lib/parent-settings.functions.ts`:
- `getParentSettings` → parent profile + all athletes (with goals + schedule slots + invite codes).
- `updateParentProfile({ firstName, lastName })`.
- `updateAthlete({ athleteId, firstName, lastName, birthdate })`.
- `updateAthleteGoals({ athleteId, sport, currentLevelKey, seasonGoalKey, longTermGoal })`.
- `replaceAthleteSchedule({ athleteId, slots[] })` (delete + insert in a transaction-ish pattern, mirroring onboarding save).
- `addAthlete({ firstName, lastName, birthdate })` → also generates an invite code via the existing path.
- `removeAthlete({ athleteId })` — soft-guard against removing the only athlete? See open question.

New in `src/lib/athlete-settings.functions.ts`:
- `getAthleteSettings`, `updateAthleteSelf({ firstName, lastName, birthdate })`.

All gated by `requireSupabaseAuth` and constrained to rows owned by the current user via existing RLS + explicit `user_id` / `parent_id` checks.

## Reusable extractions

- Extract the schedule-slot editor from `signup.parent.schedule.tsx` into `src/components/parent/schedule-editor.tsx` so onboarding and Settings share it.
- Extract the athlete invite QR card from `parent.index.tsx` into `src/components/parent/athlete-invite-card.tsx`.
- Extract the parent goals form fields into `src/components/parent/athlete-goals-form.tsx`.

## Design system

All new UI uses existing tokens (`bg-card`, `border-divider`, `text-text-primary/secondary`, `accent-ink`, `pen-highlight`, `font-display`, `font-hand`, `shadow-card`) and shadcn primitives already in use. Section cards reuse the rounded-2xl pattern from `coach.settings.tsx`. Settings gear active state matches the rest of the nav (`text-accent-ink` + `pen-highlight` on label).

## Open questions (will default as noted if you don't reply)

1. **Removing the last athlete** — block with a toast ("at least one athlete required") or allow? Default: **block**.
2. **Athlete birthdate editing** — onboarding collects it for parent-added athletes; for self-signup athletes it isn't captured. Show the field always (empty if missing) so it can be filled later? Default: **yes**.
3. **Schedule editing scope** — should editing a slot's `startsOn` retroactively change historical sessions, or only future ones? Default: **only future**, matching onboarding semantics.
