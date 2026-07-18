# Message another coach about their plan

Add a per-plan "Message about this plan" button inside the "Also coaching {athlete}" sheet (visible to Club-tier coaches). Tapping it opens a composer that starts (or reuses) a direct coach↔coach conversation and sends the message tagged to that plan — matching the parent/athlete flow.

## Scope

- Entry point: each `PlanCard` inside `src/components/coach/other-coach-plans-sheet.tsx`.
- Gated by the existing `canViewOtherCoachPlans` check in `athlete-detail-sheet.tsx` — no new tier logic (Club-only stays enforced by the parent sheet).
- Reuse the existing coach↔coach DM plumbing (`ensureDirectRoom`, `sendMessage`, `direct_rooms`) and the visual pattern of `MessageCoachAboutPlanDialog`.

## Changes

### 1. Shared composer component
Refactor `src/components/plans/message-coach-about-plan-dialog.tsx` so the dialog UI is reusable across both flows without duplicating markup:
- Keep the current parent/athlete signature and behavior working.
- Add a discriminated `mode` prop:
  - `mode: "athlete-room"` (current behavior) — uses `ensureRoom({ coachId, athleteId })`, sends with `planId`, navigates to `/parent|athlete|coach/messages/:roomId`.
  - `mode: "coach-direct"` — uses `ensureDirectRoom({ kind: "coach_coach", otherCoachId })`, sends with `planId`, navigates to `/coach/messages/:roomId`.
- Title/description adapt: "Message Coach {firstName}" + "Your message will be tagged to this plan."
- Same plan chip + textarea + Send button styling.

### 2. Allow plan tagging in coach↔coach DMs
In `src/lib/messages.functions.ts` `sendMessage`, the current line
`const planId = room.kind === "athlete" ? data.planId ?? null : null;`
drops `planId` for direct rooms. Loosen it to also allow `planId` when `room.kind === "coach_coach"` (schema already has `messages.plan_id`, and `getRoom` already selects it). Parent/athlete direct rooms remain untagged.

### 3. Wire the button into the Also-Coached-By sheet
In `src/components/coach/other-coach-plans-sheet.tsx`:
- Add a footer row to each `PlanCard` with a subtle "Message about this plan" button (icon + label), styled with existing tokens (`bg-elevated`, `border-divider`, `press`).
- Manage a local `activePlan: OtherCoachPlanDTO | null` state; clicking opens the composer with `otherCoachId = coach.coachId`, `planId`, `planTitle`, and `coachFirstName`.
- Composer closes the plan drawer on success (navigation already leaves the sheet).

## Non-goals

- No new database migration (uses existing `messages.plan_id` and `direct_rooms`).
- No changes to how the DM thread renders the plan chip (that already works via `getRoom`'s `plan_id` selection).
- No change to Coach/Pro tier gating — button is only reachable through the Club-gated sheet.

## Technical notes

- `ensureDirectRoom` already enforces "must share a rostered athlete" — always true here, since the sheet is opened from a shared-athlete context.
- `MessageCoachAboutPlanDialog` currently uses `Dialog`. Per overlay doctrine, plain `Dialog` is retired for new code — the refactored composer will migrate to `Sheet side="bottom"` with `paper-surface` so both call sites (parent/athlete and coach-to-coach) benefit consistently.
