
-- Fix #2: Restrict athletes to only see plan_moves for their active/benched plans (not drafts/templates)
DROP POLICY IF EXISTS "Athletes view plan_moves for own plans" ON public.plan_moves;
CREATE POLICY "Athletes view plan_moves for own plans"
ON public.plan_moves
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM plans p
    JOIN athletes a ON a.id = p.athlete_id
    WHERE p.id = plan_moves.plan_id
      AND a.user_id = auth.uid()
      AND p.kind = 'plan'
      AND p.status IN ('active','benched')
  )
);

-- Fix #1: Restrict UPDATE/DELETE on voice-notes objects to the uploader.
-- New uploads encode user_id as second folder segment: <room_id>/<user_id>/<uuid>.<ext>
DROP POLICY IF EXISTS "Room participants can update own voice notes" ON storage.objects;
DROP POLICY IF EXISTS "Room participants can delete own voice notes" ON storage.objects;

CREATE POLICY "Uploader can update own voice notes"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'voice-notes'
  AND is_room_participant(((storage.foldername(name))[1])::uuid, auth.uid())
  AND (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'voice-notes'
  AND is_room_participant(((storage.foldername(name))[1])::uuid, auth.uid())
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Uploader can delete own voice notes"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'voice-notes'
  AND is_room_participant(((storage.foldername(name))[1])::uuid, auth.uid())
  AND (storage.foldername(name))[2] = auth.uid()::text
);
