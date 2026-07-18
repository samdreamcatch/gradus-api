## Why the library is empty on `/coach/resources`

The `resources` table has 121 published library rows (`coach_id IS NULL`) covering the sports coaches teach — the data is there. But the RLS policies on `public.resources` only expose library rows to **parents** (via `parent_has_athlete_in_sport`). There is no SELECT policy that lets a coach read `coach_id IS NULL` rows.

So `listCoachResources` runs its `libraryResources` query as the coach and gets back zero rows, even though the query itself is correct.

## Fix

Add one policy:

```sql
CREATE POLICY "Coaches read library for sports they teach"
  ON public.resources FOR SELECT
  USING (
    coach_id IS NULL
    AND published = true
    AND EXISTS (
      SELECT 1
      FROM public.coach_levels cl
      JOIN public.coach_profiles cp ON cp.id = cl.coach_id
      WHERE cp.user_id = auth.uid()
        AND cl.sport = resources.sport
    )
  );
```

No app code changes needed — after the migration, the existing coach page will render "Gradus library" items alongside the coach's own uploads.
