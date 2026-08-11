ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'coach';

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_source_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_source_check CHECK (source IN ('coach', 'gradus'));

CREATE UNIQUE INDEX IF NOT EXISTS plans_gradus_athlete_title_uniq
  ON public.plans (athlete_id, title)
  WHERE source = 'gradus';

DROP POLICY IF EXISTS "Coaches view gradus plans for rostered athletes" ON public.plans;
CREATE POLICY "Coaches view gradus plans for rostered athletes"
  ON public.plans FOR SELECT
  TO authenticated
  USING (
    source = 'gradus'
    AND kind = 'plan'
    AND status = ANY (ARRAY['active','benched'])
    AND EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      JOIN public.coach_athletes ca ON ca.coach_id = cp.id
      WHERE cp.user_id = auth.uid() AND ca.athlete_id = plans.athlete_id
    )
  );

DROP POLICY IF EXISTS "Coaches view gradus plan_moves for rostered athletes" ON public.plan_moves;
CREATE POLICY "Coaches view gradus plan_moves for rostered athletes"
  ON public.plan_moves FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans p
      JOIN public.coach_profiles cp ON cp.user_id = auth.uid()
      JOIN public.coach_athletes ca ON ca.coach_id = cp.id AND ca.athlete_id = p.athlete_id
      WHERE p.id = plan_moves.plan_id
        AND p.source = 'gradus'
        AND p.kind = 'plan'
        AND p.status = ANY (ARRAY['active','benched'])
    )
  );