# Security Hardening — 5 findings

## 1. `athlete_goals` — Coaches view goals for rostered athletes only

**Current policy** joins only `coach_profiles` (coach owns the row), so a coach can still read goals after the athlete is removed from their roster.

**Fix:** add an `EXISTS` on `coach_athletes (coach_id, athlete_id)` to the SELECT policy.

**Functional change:** Coaches lose visibility into goals for ex-roster athletes. If a parent removes the coach link, the coach immediately stops seeing that athlete's goals. (Matches the existing pattern for other coach reads.)

## 2. `athlete_lesson_slots` — same fix as #1

Same shape (`coach_profiles`-only check today). Add the `coach_athletes` join.

**Functional change:** Same as #1 — coaches stop seeing lesson slots for athletes no longer on their roster.

## 3. `is_parent_of_plan` / parent `plan_moves` access

`plan_moves` parent SELECT policy uses `is_parent_of_plan(plan_id)`, which returns true for any plan owned by their athlete — including drafts and templates (`kind <> 'plan'` or `status` not in `active/benched`).

**Fix:** drop/replace the parent `plan_moves` SELECT policy with one that mirrors the parent `plans` filter:

```sql
USING (
  EXISTS (
    SELECT 1
    FROM plans p
    JOIN athletes a ON a.id = p.athlete_id
    JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE p.id = plan_moves.plan_id
      AND pp.user_id = auth.uid()
      AND p.kind = 'plan'
      AND p.status IN ('active','benched')
  )
)
```

(Leaving `is_parent_of_plan` itself unchanged — it's used in INSERT WITH CHECK on `plan_sessions` where the broader semantic is correct.)

**Functional change:** None expected — the `plans` SELECT policy already hides drafts/templates from parents, so they currently can't reach those `plan_moves` rows through the app anyway. This just closes the direct-API hole.

## 4. `voiceBuildPlan` — cap audio size

Add a hard cap in the input validator before the Blob is forwarded to ElevenLabs.

- Limit: **8 MB** (≈ 90s of opus/webm at typical voice bitrates; current UI auto-stops at 90s).
- Reject with a clear error before any external API call.

**Functional change:** Recordings larger than 8 MB are rejected with "Recording too long — please try again." In practice the existing 90s recording cap keeps real users well under this.

## 5. `src/lib/voice.functions.ts` server-only marker

The file already only exports `createServerFn` handlers and reads `process.env` inside handlers (not at module scope). To make the server-only intent explicit and prevent accidental client imports, add a top-of-file guard:

```ts
if (typeof window !== "undefined") {
  throw new Error("voice.functions.ts is server-only");
}
```

**Functional change:** None at runtime; build-time/dev-time safety only.

---

## Implementation

- **One migration** containing:
  - Drop + recreate `athlete_goals` "Coaches view goals for rostered athletes" with `coach_athletes` join.
  - Drop + recreate `athlete_lesson_slots` "Coaches view slots for rostered athletes" with `coach_athletes` join.
  - Drop + recreate the parent SELECT policy on `plan_moves` with the inlined `kind='plan' AND status IN (...)` filter.
- **`src/lib/voice.functions.ts`** edits:
  - Add top-of-file `window` guard.
  - In `voiceBuildPlan` input validator, reject `audio.size > 8 * 1024 * 1024`.

## Confirm before I build

The only user-visible behavior change is #1/#2: **coaches will lose read access to goals and lesson slots for athletes removed from their roster.** Everything else is a no-op for normal users. OK to proceed?
