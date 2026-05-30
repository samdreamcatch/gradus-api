# Plan: lock down plan deletion + move-lookup defence-in-depth

## 1. Harden `deletePlan` server-side

File: `src/lib/plans.functions.ts` (the `deletePlan` server fn, lines ~484–498).

Change behaviour to:

1. Run `assertPlanOwned(supabase, data.id, coachId)` first (which already returns `{ id, kind, status, athlete_id }`).
2. Allow deletion only when `kind === "template"` OR `status === "draft"`. Otherwise throw `"Active or benched plans can't be deleted — bench the plan instead."`.
3. Only after the guard passes, delete `plan_moves` rows for the plan, then delete the `plans` row (still scoped by `coach_id`).

This makes the server enforce what the UI already does (the swipe-to-delete row in `coach.plans.tsx` is only rendered for the `drafts` and `templates` filters). The `moves` library table is **not** touched — only the plan's own `plan_moves` snapshot rows are removed.

## 2. Defence-in-depth on move lookups

Same file. Add an explicit `coach_id` filter to the `moves` lookups so a coach can never reference another coach's move (RLS already blocks it, but belt + suspenders):

- `addMoveToPlan` (line ~600): `.from("moves").select(...).eq("id", data.moveId).eq("coach_id", coachId)`.
- `addLibraryMovesToPlan` (line ~855): `.from("moves").select(...).in("id", data.moveIds).eq("coach_id", coachId)`.

No other behavioural change; the error paths ("Move not found" / `inserted: 0`) already handle the empty result.

## 3. Update `@security-memory`

Add a rule documenting the new invariant so future scans and future edits don't loosen it:

> **Plan deletion rule.** `deletePlan` may only hard-delete plans where `kind = 'template'` OR `status = 'draft'`. Plans with `status` of `active` or `benched` must never be deletable — they transition to `benched` via the bench flow / `activate_plan` instead. The UI also restricts the delete affordance to the drafts and templates filters; the server enforces the same rule independently.
>
> Deleting a plan removes its `plan_moves` rows (the plan-scoped snapshot) only. The coach's `moves` library is never touched by plan deletion.
>
> Coach-scoped move lookups in `addMoveToPlan` and `addLibraryMovesToPlan` filter by both `id` and `coach_id` as defence-in-depth on top of RLS.

Leave the existing memory content (app model, intentional `SECURITY DEFINER` functions, leaked-password-protection-off note, etc.) intact.

## Out of scope (per your decision)

- No `TODO`/guard for a future practice-log table. We'll revisit when that table lands.
- No database migration, no RLS changes, no auth changes.

## Verification

1. Re-read the diff in `plans.functions.ts` to confirm the chain shape stays `.middleware().inputValidator().handler()` and no other call sites are touched.
2. Run the security scan and confirm no new findings; the existing accepted `SECURITY DEFINER` posture is unchanged.
3. Manual smoke: from the Plans screen, deleting a draft and a template still works; the active/benched filters don't show a delete affordance (unchanged); a direct call to `deletePlan` with an active plan id now throws the new error.
