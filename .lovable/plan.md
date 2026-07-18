## Goal

When a coach taps a plan chip inside a message and the plan belongs to **another** coach (shared athlete, Club tier), open the same read-only bottom sheet used from the athlete profile — never the plan editor. Own plans keep navigating to the editor.

## Changes

### 1. Extend message + room payloads (`src/lib/messages.functions.ts`)
- `MessageDTO.plan` gains `coachId: string` (plan owner). Fetched alongside `title` in the existing `plansById` query (add `coach_id` to the select).
- `RoomDTO` gains `myCoachId: string | null` — populated from the `me.coach.id` lookup that already happens in `getRoom`. Lets the client compare ownership without extra round-trips.
- Update the `MessageDTO` / `RoomDTO` type exports so components consume the new fields.

### 2. New read-only fetch: `getOtherCoachPlanForMessage`
New server fn in `src/lib/coach-athlete-detail.functions.ts` (colocated with the existing other-coach DTOs). Input: `{ planId }`. Behavior:
- `requireSupabaseAuth`; resolve caller's coach profile.
- Load plan (`id, coach_id, athlete_id, title, notes, status, updated_at`); 404 if missing.
- Authorize: caller must be Club tier (`coach_effective_tier(_coach_id) = 'club'`) AND share the plan's athlete via `coach_athletes`. Otherwise throw "Not allowed".
- Load coach profile (first/last, sports via `coach_levels`), athlete first name, plan moves (position/name/description/cue/why/target_kind/target_value), and sessions-in-last-30d count — mirroring the shape built inside `getAthleteDetail` so we can reuse the existing card.
- Return `{ coach: OtherCoachDTO (single-plan array), athleteFirstName }` so the existing `OtherCoachPlansSheet` renders it unchanged.

### 3. Route the message plan chip (`src/components/messages/room-view.tsx`)
Replace the current `<Link to={planHrefForRole(...)}>` chip render with a small branch:
- If `room.myRole === 'coach'` AND `m.plan.coachId && m.plan.coachId !== room.myCoachId` → render a `<button>` that sets `openOtherCoachPlanId` state.
- Otherwise → keep the existing `<Link>` (own plan → editor; parent/athlete viewers → their existing routes, no behavior change).

Mount `<OtherCoachPlansSheet coach={data?.coach ?? null} athleteFirstName={data?.athleteFirstName ?? ''} onOpenChange={...} />` at the bottom of `RoomView`, driven by a `useQuery(['other-coach-plan', planId], getOtherCoachPlanForMessage)` gated on the open id. Reusing `OtherCoachPlansSheet` guarantees the "exact same style as from the athlete profile" — same header, same `PlanCard`, same `MoveRow`, same "Message about this plan" affordance.

### 4. Not changed
- Editor route (`/coach/plans/$planId`) is untouched — still the destination for the coach's own plans.
- Parent/athlete plan chips keep their current links.
- `getPlan` server fn stays broadened (from previous fix) so any residual direct-URL navigation still resolves.

## Files touched

- `src/lib/messages.functions.ts` — add `coach_id` to plan select, populate `plan.coachId` and `room.myCoachId`.
- `src/lib/coach-athlete-detail.functions.ts` — add `getOtherCoachPlanForMessage` server fn.
- `src/components/messages/room-view.tsx` — branch plan-chip render + mount sheet.

No schema/RLS changes required (existing coach-shared-athlete policies already permit reads).