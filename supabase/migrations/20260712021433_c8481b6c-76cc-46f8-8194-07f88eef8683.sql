
-- 1. Athletes updating their own row
DROP POLICY IF EXISTS "Athletes can update own row" ON public.athletes;

CREATE POLICY "Athletes can update own row"
ON public.athletes
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND user_id      IS NOT DISTINCT FROM (SELECT a.user_id      FROM public.athletes a WHERE a.id = athletes.id)
  AND parent_id    IS NOT DISTINCT FROM (SELECT a.parent_id    FROM public.athletes a WHERE a.id = athletes.id)
  AND self_managed IS NOT DISTINCT FROM (SELECT a.self_managed FROM public.athletes a WHERE a.id = athletes.id)
  AND is_test      IS NOT DISTINCT FROM (SELECT a.is_test      FROM public.athletes a WHERE a.id = athletes.id)
);

-- 2. Parents updating their own athletes (same class of hole, closing preemptively)
DROP POLICY IF EXISTS "Parents can update own athletes" ON public.athletes;

CREATE POLICY "Parents can update own athletes"
ON public.athletes
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.parent_profiles pp
    WHERE pp.id = athletes.parent_id AND pp.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.parent_profiles pp
    WHERE pp.id = athletes.parent_id AND pp.user_id = auth.uid()
  )
  AND parent_id    IS NOT DISTINCT FROM (SELECT a.parent_id    FROM public.athletes a WHERE a.id = athletes.id)
  AND user_id      IS NOT DISTINCT FROM (SELECT a.user_id      FROM public.athletes a WHERE a.id = athletes.id)
  AND self_managed IS NOT DISTINCT FROM (SELECT a.self_managed FROM public.athletes a WHERE a.id = athletes.id)
  AND is_test      IS NOT DISTINCT FROM (SELECT a.is_test      FROM public.athletes a WHERE a.id = athletes.id)
);
