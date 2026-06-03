-- 1) plan_moves: route parent SELECT through is_parent_of_plan(), keep kind/status filter
DROP POLICY IF EXISTS "Parents view plan_moves for own athletes" ON public.plan_moves;

CREATE POLICY "Parents view plan_moves for own athletes"
ON public.plan_moves
FOR SELECT
TO authenticated
USING (
  public.is_parent_of_plan(plan_id)
  AND EXISTS (
    SELECT 1 FROM public.plans p
    WHERE p.id = plan_moves.plan_id
      AND p.kind = 'plan'
      AND p.status IN ('active', 'benched')
  )
);

-- 2) voice-notes bucket: add INSERT/UPDATE/DELETE policies scoped to room participants
DROP POLICY IF EXISTS "Room participants can upload voice notes" ON storage.objects;
DROP POLICY IF EXISTS "Room participants can update own voice notes" ON storage.objects;
DROP POLICY IF EXISTS "Room participants can delete own voice notes" ON storage.objects;

CREATE POLICY "Room participants can upload voice notes"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'voice-notes'
  AND public.is_room_participant(((storage.foldername(name))[1])::uuid, auth.uid())
);

CREATE POLICY "Room participants can update own voice notes"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'voice-notes'
  AND public.is_room_participant(((storage.foldername(name))[1])::uuid, auth.uid())
)
WITH CHECK (
  bucket_id = 'voice-notes'
  AND public.is_room_participant(((storage.foldername(name))[1])::uuid, auth.uid())
);

CREATE POLICY "Room participants can delete own voice notes"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'voice-notes'
  AND public.is_room_participant(((storage.foldername(name))[1])::uuid, auth.uid())
);