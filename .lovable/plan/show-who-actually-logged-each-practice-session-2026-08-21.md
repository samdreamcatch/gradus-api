# Show who actually logged each practice session

The practice log says "Parent logged for Jamie" instead of naming the guardian (e.g. "Junie
logged for Jamie").

## Cause (confirmed)

Each session row stores which parent logged it, and the log tries to look up that parent's
first name. But profile visibility only allows a parent to read *their own* profile (plus
coaches reading parents of rostered athletes). So:

- A co-guardian viewing a session logged by the other guardian can't read that name.
- An athlete viewing a parent-logged session can't read it either.

In both cases the lookup returns nothing and the label falls back to the generic word
"Parent".

## Fix

Resolve the logging guardian's first name server-side, with privileged access, inside the
practice-log fetch — scoped strictly to the parent IDs that appear on that plan's own
sessions, and returning only the first name. No profile visibility is widened, and no other
field is exposed.

Result: every entry reads "<Name> logged for Jamie" for whichever guardian logged it, and
athlete-logged entries keep showing the athlete's name as they do today.

## Also covered

The same generic-fallback pattern appears in the duplicate-log nudge ("… logged a session
for this plan"), which reads the same field, so it gets the correct name automatically.

## Technical details

- `src/lib/plan-sessions.functions.ts` → `getPlanSessionLog`: replace the RLS-scoped
  `parent_profiles` name lookup with a handler-scoped
  `await import("@/integrations/supabase/client.server")` admin read of
  `id, first_name` filtered by `.in("id", parentIds)`, where `parentIds` comes only from the
  already-authorized session rows for that plan. Keep the existing `"Parent"` fallback for
  deleted profiles.
- No schema or policy migration required.
- Verify by loading the shared plan as the co-guardian and as the athlete and confirming the
  entry names the guardian who logged it.
