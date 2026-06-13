## Scope

Resolve all 16 scanner findings: fix what's a real gap, enable the auth toggle, and ignore the ones that are intentional product decisions or canonical patterns.

---

## 1. Verbose server error leaks (1 finding)

Two of the three flagged sites are app code we own; the third is auto-generated.

**Edit `src/lib/ask-gradus.functions.ts`** (line ~19):
```ts
const key = process.env.LOVABLE_API_KEY;
if (!key) {
  console.error("[ask-gradus] LOVABLE_API_KEY not set");
  throw new Error("AI service is unavailable. Please try again later.");
}
```

**Edit `src/lib/plan-sessions.functions.ts`** (line ~260): same pattern, prefix `[plan-sessions]`.

**Leave `src/integrations/supabase/auth-middleware.ts` alone** — header says "automatically generated. Do not edit it directly." That sub-item only fires when the deployment is missing core Supabase env vars (a misconfiguration condition that shouldn't occur on Lovable Cloud). Note in security memory; revisit if the file becomes editable.

Mark finding fixed after the two edits land.

---

## 3. Leaked password protection (1 finding)

Call `supabase--configure_auth` with:
- `password_hibp_enabled: true`
- `disable_signup: false`
- `external_anonymous_users_enabled: false`
- `auto_confirm_email: false`

New sign-ups and password changes get checked against Have I Been Pwned. No code change.

---

## 4. SECURITY DEFINER findings (10 findings) → ignore as intentional

Every flagged function falls into one of three safe categories:

- **RLS helpers** (must be SECURITY DEFINER to avoid recursion, callable by `authenticated` because policies invoke them): `is_parent_of_athlete`, `is_parent_of_plan`, `is_room_participant`, `parent_has_athlete_in_sport`, `coach_has_rostered_athlete_of_parent`.
- **RPCs with internal auth checks** (verify `auth.uid()` before doing anything): `activate_plan`, `seed_coach_library`, `get_parent_by_invite_code`, `record_invite_lookup_attempt`.
- **Trigger bodies** (only run as BEFORE/AFTER triggers, not invokable by users): `validate_athlete_primary_coach`, `validate_coach_athlete_sport`, `cleanup_coach_athlete_sports`, `prevent_dual_role_coach`, `prevent_dual_role_parent`, `validate_lesson_slot_override`, `update_updated_at_column`, `validate_message_plan`.

Mark all 10 as ignored. Update security memory so future scans don't re-flag the standard pattern.

---

## 2. RLS coverage findings (4 findings)

Based on your answers:

- **`lesson_wrap_ups` coach-only** → intentional. Ignore.
- **`pre_lesson_briefings` coach-only** → intentional. Ignore.
- **`resources` parent/athlete-only** → intentional. Ignore.
- **`message_rooms`** → real gap. Add a client INSERT policy so coach, athlete, or parent can start a room, while keeping the structural rule that the room is always tied to a real coach↔athlete pairing (which implicitly includes that athlete's parent because every athlete has a `parent_id`).

### Migration: INSERT policy for `message_rooms`

Allow `authenticated` users to insert a row when:
1. The caller is one of the three parties on that row, AND
2. The (`coach_id`, `athlete_id`) pair is a real rostered relationship in `coach_athletes` (so users can't spawn rooms with arbitrary strangers).

```sql
CREATE POLICY "Participants can create rooms"
ON public.message_rooms
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.coach_athletes ca
    WHERE ca.coach_id = message_rooms.coach_id
      AND ca.athlete_id = message_rooms.athlete_id
  )
  AND (
    -- caller is the coach
    EXISTS (SELECT 1 FROM public.coach_profiles cp
            WHERE cp.id = message_rooms.coach_id AND cp.user_id = auth.uid())
    -- caller is the athlete
    OR EXISTS (SELECT 1 FROM public.athletes a
               WHERE a.id = message_rooms.athlete_id AND a.user_id = auth.uid())
    -- caller is the athlete's parent
    OR EXISTS (
      SELECT 1 FROM public.athletes a
      JOIN public.parent_profiles pp ON pp.id = a.parent_id
      WHERE a.id = message_rooms.athlete_id AND pp.user_id = auth.uid()
    )
  )
);
```

No existing SELECT policy changes; the `is_room_participant` helper already handles read access for all three roles.

---

## Order of operations

1. **Code edits**: `ask-gradus.functions.ts` and `plan-sessions.functions.ts`.
2. **Auth config**: `configure_auth` with HIBP on.
3. **Migration**: add the `message_rooms` INSERT policy (single migration, runs through the approval flow).
4. **Findings management** (`manage_security_finding`):
   - Fixed: verbose error leaks (1), `message_rooms` (1).
   - Ignored: 10 SECURITY DEFINER findings, `lesson_wrap_ups`, `pre_lesson_briefings`, `resources`, plus the auth-middleware sub-item of finding D.
5. **Update security memory** with: (a) standard SECURITY DEFINER pattern is accepted, (b) the three coach/parent/athlete read-scope decisions, (c) the auth-middleware note.
6. **Re-run the scan** to confirm a clean result (or only the documented ignored items remain).
