
## Parent Plans slice

Give the parent a read-only view of plans coaches have assigned to their athlete(s) — list page + detail page that matches the screenshot — all themed with the existing design system (paper background, Fraunces display, pen-highlight accents).

## Database (migration)

Parents currently have **no RLS access** to `plans` or `plan_moves`. Add read-only policies and a small helper.

1. SECURITY DEFINER helper `public.is_parent_of_plan(_plan_id uuid) returns boolean` — returns true when the calling user is a parent of the plan's `athlete_id`.
2. New policy on `plans`: `"Parents view plans for own athletes"` — `FOR SELECT TO authenticated USING (kind = 'plan' AND status IN ('active','benched') AND public.is_parent_of_plan(id))`. Drafts and templates stay invisible to parents.
3. New policy on `plan_moves`: `"Parents view plan_moves for own athletes"` — `FOR SELECT TO authenticated USING (public.is_parent_of_plan(plan_id))`.
4. No new tables, no GRANT changes needed (both tables already grant SELECT to `authenticated`).

## Server functions — new file `src/lib/parent-plans.functions.ts`

Both use `requireSupabaseAuth`; RLS does the scoping.

- `listParentPlans()` → returns `{ athletes: AthleteOptionDTO[], plans: ParentPlanSummaryDTO[] }`.
  Loads parent_profile by user_id, joins athletes (parent's own), then `plans` where `athlete_id IN (...)` and `kind='plan'` and `status IN ('active','benched')`, plus `coach_profiles` for coach name and a `plan_moves` count/minutes aggregate. Summary fields: `id, title, status, athleteId, athleteName, coachName, moveCount, totalMinutes, updatedAt`.
- `getParentPlan({ id })` → returns `{ plan: ParentPlanDetailDTO }`. Same shape as coach `PlanDetailDTO` minus edit-only bits, plus `coachName`. Validates the plan is `kind='plan'` and status active/benched (RLS already enforces parent ownership).

## Routes

### `src/routes/_authenticated/parent.plans.tsx` (list)

- Header: small "Plans" eyebrow, Fraunces h1 "From your coach", subtitle "What [athlete first names] is working on".
- **Athlete filter chips** row (only rendered if parent has 2+ athletes). Pill chips using `bg-card` / active `bg-accent text-accent-foreground`. Default selection: first athlete alphabetically. "All" chip on the left.
- Two sections, both paper cards:
  - **Active** — list of plan cards (large, pen-bordered if active). Card click → `/parent/plans/$planId`.
  - **History** (benched) — collapsed by default behind a "Show past plans (N)" toggle; same card style but muted, no pen border.
- Plan card content: athlete name + coach name eyebrow, Fraunces title, footer meta "N moves · ~X min".
- Empty state: paper card with handwritten Caveat note "No plans yet — your coach will share one here."
- Bottom-nav active state remains "Plans" (see nav change below).

### `src/routes/_authenticated/parent.plans.$planId.tsx` (detail)

Mirrors the screenshot exactly, on the paper background with ruled lines.

- Top bar: settings cog (top right, links to existing settings if available else stub), "← Back" link to `/parent/plans`.
- Header block:
  - Eyebrow `text-secondary` small: "{AthleteFirstName} · Coach {CoachFirstName} {CoachLastName}".
  - Fraunces h1 (text-h1, font-black) — plan title.
- Action row (sticky-feeling, not actually sticky):
  - Primary pill **"Start session timer →"** — pen highlight (`bg-accent text-accent-foreground` rounded-pill). Stub: `toast("Session timer coming soon")`.
  - Secondary text link **"Slide →"** to the right — `text-accent-ink`. Stub: same coming-soon toast.
- "From the Coach" small uppercase label.
- Move cards (in `position` order):
  - Collapsed: white `bg-card` rounded-lg with `shadow-card`, row: `{value} {reps|min}` (target value with unit-suffix in `text-text-tertiary`), then move name in `font-display`, chevron on the right.
  - Click to expand (local state, no server). Expanded card grows a pen border (`border-accent`), shows `description` body text, then two pill chips: **"How do I cue this?"** and **"Why is this assigned?"** — both stub to `toast("Coming soon — we'll surface the coach's cues here")`.
  - If `description` is empty, just show chips. Cue/why content lives in the chip stubs for now (not rendered inline) since chips are themselves the affordance per the UI shell.
- Bottom CTA pill **"💬 Message {CoachFirstName} about this plan"** — pen highlight, full-width-ish centered. Stub toast.
- Page wrapper inherits `<ParentBottomNav />` from layout, so add `pb-32` to content.

## Bottom nav

Edit `src/components/parent/bottom-nav.tsx`:
- Convert the "Plans" item from a `<button>`+toast to a `<Link to="/parent/plans">`.
- Mark Dashboard active only on `/parent` (use `activeOptions={{ exact: true }}`).
- Plans active when on `/parent/plans` or `/parent/plans/$planId`.

## Routing details

Both new route files use `createFileRoute("/_authenticated/parent/plans")` and `(".../plans/$planId")`. Detail page uses `Route.useParams()` for `planId`. Both have `errorComponent` (toast-style inline card) and `notFoundComponent`.

Data fetching uses the project's existing pattern (`useServerFn` + `useQuery`, since other parent routes in the repo follow that — not `ensureQueryData` loaders), so we don't trip the SSR-auth pitfall.

## Out of scope (explicit)

- No write actions for the parent (no acknowledge, no completion logging) — that's a later slice.
- No real timer / slide mode / cue assistant / messaging — all stubbed with "coming soon" toasts.
- No edit affordances.
- No changes to coach-side code.

## Files

- `supabase/migrations/...` — RLS helper + 2 policies (via migration tool)
- `src/lib/parent-plans.functions.ts` — new
- `src/routes/_authenticated/parent.plans.tsx` — new
- `src/routes/_authenticated/parent.plans.$planId.tsx` — new
- `src/components/parent/bottom-nav.tsx` — wire Plans link
