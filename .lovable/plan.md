## Fork-on-reassign for active plans

Today, editing a plan's athlete assignment (or moving a shared/public active plan to an athlete) mutates the original row in place. That destroys the original assignment or the shared plan. We'll change reassignment to **fork** the plan when the source is `active`, so the original stays intact and a new plan is created for the new athlete.

### Behavior

When the coach changes the assignment on a plan whose current `status = 'active'`:

- **Active + assigned → different athlete**: keep the original plan attached to Athlete A (status stays `active`), create a new plan for Athlete B (cloned title/notes/moves, status `draft` — same as today's "create from template" path).
- **Active + assigned → cleared (null)**: keep original active with Athlete A, create a new unassigned draft (public-shareable) clone.
- **Active + shared/public (athlete_id null) → athlete**: keep the original public/shared active plan intact, create a new draft assigned to the athlete.
- **Active + assigned → same athlete**: no fork (no-op).

For any non-active source (`draft`, `benched`), keep today's in-place update behavior — those aren't "live" plans, so mutating them is fine.

Template plans are unchanged (they already have a dedicated "Assign to athlete" flow that forks via `useTemplate`).

### Where the change lives

Server-side, in `updatePlan` (`src/lib/plans.functions.ts`). We keep the client mutation call sites the same — the server decides whether to update-in-place or fork, and returns the new plan id when it forks so the editor can navigate to the new copy.

```text
updatePlan({ id, athleteId? , ... })
  ├── load current { kind, status, athlete_id, title, notes }
  ├── if athleteId is in the patch AND kind='plan' AND status='active'
  │      AND (patch.athleteId ?? null) !== (current.athlete_id ?? null):
  │        → fork: insert new plan row (draft, athlete_id = patch.athleteId),
  │          copy plan_moves, return { ok, forkedId }
  │        → leave the original row untouched
  └── else: apply patch in place as today, return { ok }
```

The share_token / shared_at fields stay on the original (the public link keeps working). The new forked copy starts as a fresh draft with no share token, matching how "create from template" works today.

### Client change

`coach.plans.$planId.tsx`: after `planUpdate.mutateAsync(...)` for an assignment change, if the response includes `forkedId`, `navigate({ to: "/coach/plans/$planId", params: { planId: forkedId } })` and toast something like "Created a copy for {athlete name}. Original plan kept for {previous athlete / public link}." No change to any other call site of `updatePlan`.

### Not in scope

- Renaming the plan title, editing notes, or editing moves on an active plan — still mutates in place (user's message is specifically about the athlete assignment; changing a title on an active plan is not a fork trigger).
- Athlete/parent-side plan views.
- DB schema — no migration required.

### Verification

- Typecheck.
- Manual: (a) active plan assigned to A → reassign to B → expect two plans, A still active with original, B has new draft copy. (b) active shared plan (no athlete) → assign to athlete → original shared plan still exists and its share link still resolves, new draft exists for the athlete. (c) draft plan → reassign athlete → in-place update, no fork.
