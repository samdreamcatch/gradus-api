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