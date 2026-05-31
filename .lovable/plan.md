## What I found so far

Before making any code changes, I dug into the data and the wiring:

- **`plan_sessions` table is completely empty** — 0 rows total, not just for Beverly. Nothing has ever been persisted.
- **The pipeline itself is correct**: when a parent submits via the feedback modal, `submitPlanSession` inserts into `plan_sessions` with the plan's `athlete_id` and the parent's `parent_profiles.id`. The coach detail view (`coach.plans.$planId.tsx`) already reads from the same table via `getPlanSessions`, and the RLS policy "Coaches view sessions for own plans" lets the coach see any session on a plan they own — regardless of whether a parent or athlete submitted it. So routing isn't the problem; **nothing is being written**.
- **No server-fn logs and no Postgres errors** mention `plan_sessions` or `submitPlanSession`. There's no evidence of a failed insert attempt either.
- **There is only one logging affordance on the parent plan page** — slide-to-start → timer → "End session" → feedback modal → "Submit to Coach". There's no quick-log shortcut. If June expected to log 25 sessions, she'd have had to complete that full flow 25 times.

That points at one of three things, and I want to confirm which before changing code:

1. June never actually completed the slide → end → modal → submit flow (e.g. she expected the slide gesture to log a session, or the modal was dismissed without picking a flow-state dot, which disables the Submit button).
2. The submit ran but errored silently (e.g. auth-token attacher race, RLS rejection) without surfacing as a toast or server-fn log.
3. June remembers seeing the old hash-based stub counts (the spec originally seeded fake counts of 0–30 per plan) and thinks they were real submissions.

## Plan

### 1. Instrument the parent submit path (one short pass)

In `parent.plans.$planId.tsx` around the existing `submitMutation` onSuccess/onError:
- Add a `console.info("[plan-session] submit success", { planId, stateIndex, durationSeconds })` and a `console.error("[plan-session] submit failed", err)` so future attempts are visible in the preview console without changing UX.
- Confirm the toast.error already wraps the `submitMutation.mutateAsync` call (it does), so any real RLS or network failure would surface to the user too.

In `plan-sessions.functions.ts` inside `submitPlanSession.handler`:
- Log the resolved `parent.id`, `plan.athlete_id`, and the insert error (if any) to the server before throwing, so we can see the exact reason in `server-function-logs` next time someone submits.

These are diagnostic-only — they don't change behavior.

### 2. Reproduce as June

After (1), log in as June Cleaver in the preview, open "Beverly Voice Verbose", slide to start, end the session, pick a flow-state dot, type a note, and submit. Then:
- Check the preview console for the `[plan-session]` lines.
- Re-query `plan_sessions` to confirm the row landed.

If the insert lands, the wiring is fine and June's previous "25 sessions" were never actually submitted — most likely cause #1 or #3 above. We'd then decide whether to make the slide gesture more obviously "this is just the timer, you still have to fill out the modal" (small copy/UX tweak, separate task), and optionally seed a handful of demo sessions for Beverly so the coach view isn't empty for the demo.

If the insert fails, the server log and console will tell us exactly which step (auth, parent lookup, RLS) is rejecting it, and the fix follows from there (most likely an `is_parent_of_plan` mismatch or a parent_profiles row that doesn't match `auth.uid()`).

### 3. (Conditional) Backfill for the demo

Only if you want Beverly's coach view populated for a walkthrough and the live submit path checks out, I'd insert ~25 plausible sessions on plan `Beverly Voice Verbose` attributed to June (`parent_id = 8a59c3ad-…`, `athlete_id = ccff0f5e-…`) with a realistic spread across the 5 flow states and `logged_at` spaced over the last few weeks. I'll only do this after you confirm — it's test data, not real history.

## Technical details

- Plan: `95770275-2276-4673-b892-3b42372e3ae5` "Beverly Voice Verbose", coach `e82ce1b6-…`, athlete `ccff0f5e-…` (Beverly), status `active`.
- Parent: `8a59c3ad-…` (June Cleaver), `parent_profiles.user_id = f5845b01-…`.
- RLS on `plan_sessions` INSERT requires `pp.user_id = auth.uid()` AND `is_parent_of_athlete(athlete_id)` AND `is_parent_of_plan(plan_id)` — all should evaluate true for June against this plan, so a failure would point at session/token attachment rather than the policy itself.
- Coach RLS on SELECT is `EXISTS (… plans JOIN coach_profiles WHERE p.id = plan_sessions.plan_id AND cp.user_id = auth.uid())` — coach can read any session for a plan they own, regardless of who inserted it. No code change needed for the "parent and athlete logs both flow to the coach" requirement; it's already true by construction.
