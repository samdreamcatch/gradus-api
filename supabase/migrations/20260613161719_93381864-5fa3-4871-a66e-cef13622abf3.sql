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
    EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      WHERE cp.id = message_rooms.coach_id
        AND cp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.athletes a
      WHERE a.id = message_rooms.athlete_id
        AND a.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.athletes a
      JOIN public.parent_profiles pp ON pp.id = a.parent_id
      WHERE a.id = message_rooms.athlete_id
        AND pp.user_id = auth.uid()
    )
  )
);