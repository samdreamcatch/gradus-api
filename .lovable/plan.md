## Coach Onboarding — Slice 2

### Sports & pre-seeded levels

Catalog hard-coded in `src/lib/coach-sports.ts`:

- **Tennis** — USTA NTRP: 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 7.0
- **Golf** — Beginner, High handicap (19+), Mid handicap (10–18), Low handicap (1–9), Scratch (0 or better)
- **Figure Skating** — U.S. Figure Skating test track: Basic Skills, Pre-Preliminary, Preliminary, Pre-Juvenile, Juvenile, Intermediate, Novice, Junior, Senior

Each level stored by a stable `level_key` (e.g. `ntrp_3_5`) so the display label can evolve without breaking data.

### Data model (new migration)

- `coach_profiles` — one row per coach: `user_id` (unique FK to auth.users), `first_name`, `last_name`, `onboarded_at` (null until wizard completed).
- `coach_levels` — one row per (coach, sport, level_key): `coach_id`, `sport`, `level_key`, `practice_hours_per_week` (numeric, 0–40). Unique on `(coach_id, sport, level_key)`. The set of sports a coach coaches = distinct sports in this table.

Both tables: RLS on, policies scoped to `auth.uid() = coach_profiles.user_id` (coach can only read/write their own data). Auto-update `updated_at` trigger.

### Server functions (`src/lib/coach-profile.functions.ts`)

All use `requireSupabaseAuth` middleware:

- `getCoachProfile()` → returns `{ profile, levels }` or `{ profile: null, levels: [] }`
- `saveCoachProfile({ firstName, lastName })` → upsert
- `saveCoachLevels({ entries: [{ sport, levelKey, hoursPerWeek }] })` → replaces the coach's full level set in one transaction
- `completeOnboarding()` → stamps `onboarded_at = now()`

Wrapped via `useQuery`/`useMutation` in `src/hooks/use-coach-profile.ts`.

### Routes

- `src/routes/_authenticated/onboarding.tsx` — the wizard. On mount: if `onboarded_at` is set, redirect to `/coach`.
- `src/routes/_authenticated/coach.tsx` — on mount: if `onboarded_at` is null, redirect to `/onboarding`. Add a "Settings" link.
- `src/routes/_authenticated/coach.settings.tsx` — same form sections as the wizard, but in a single editable page (not stepped). Saves field-by-field.

Login flow: signup → `/coach` → redirect to `/onboarding` → finish wizard → `/coach`.

### Wizard UX

5 steps in a paper-card layout consistent with the design system:

1. **Your name** — First / Last inputs.
2. **Sports you coach** — toggle chips for Tennis, Golf, Figure Skating (multi-select, at least one required). Uses pen-highlight on selected chip.
3. **Levels per sport** — for each selected sport, a checkbox list of its pre-seeded levels. At least one level per sport required.
4. **Practice expectations** — for each selected level, a numeric input "hours/week" with a Caveat-styled hint ("e.g. 3 hours"). Accepts decimals, 0–40.
5. **Review** — read-only summary; "Finish" calls `completeOnboarding` then routes to `/coach`.

Top of card: small progress indicator (1 of 5) plus step title in Fraunces. "Back"/"Continue" buttons; "Continue" disabled until current step validates. Each step's data persists to Supabase as the user advances (so a refresh mid-wizard resumes where they left off).

### Settings page

Single scrollable page with three sections (Name, Sports & levels, Practice expectations). Each section has its own "Save" button. No step gating. Reuses the same form components as the wizard via shared sub-components in `src/components/onboarding/`.

### Files

New:
- migration (coach_profiles, coach_levels, RLS, trigger)
- `src/lib/coach-sports.ts`
- `src/lib/coach-profile.functions.ts`
- `src/hooks/use-coach-profile.ts`
- `src/routes/_authenticated/onboarding.tsx`
- `src/routes/_authenticated/coach.settings.tsx`
- `src/components/onboarding/` — `wizard-shell.tsx`, `name-step.tsx`, `sports-step.tsx`, `levels-step.tsx`, `practice-step.tsx`, `review-step.tsx`, `sport-chip.tsx`

Modified:
- `src/routes/_authenticated/coach.tsx` — onboarding gate + Settings link

### Out of scope (call out)

- No athlete/student records yet — this slice is profile-only.
- No avatar upload, bio, credentials, or scheduling.
- No org/team concept — single coach per account.
