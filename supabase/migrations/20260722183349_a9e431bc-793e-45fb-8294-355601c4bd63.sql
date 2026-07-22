DROP POLICY IF EXISTS "Read sport tags with resource" ON public.resource_sports;

CREATE POLICY "Read sport tags with resource"
ON public.resource_sports
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.resources r
    WHERE r.id = resource_sports.resource_id
      AND (
        r.published = true
        OR (r.coach_id IS NOT NULL AND public.caller_is_resource_owner(r.coach_id))
        OR (r.coach_id IS NOT NULL AND public.athlete_has_coach_upload(r.id))
        OR (r.coach_id IS NOT NULL AND public.parent_has_coach_upload(r.id))
      )
  )
);