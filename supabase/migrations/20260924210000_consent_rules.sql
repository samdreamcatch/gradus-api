-- Consent rules (PRD §6.13 A7, decision #32, milestone S1, second PR):
-- athletes under 18 send text only. The server refuses a minor's voice send;
-- this closes the other door, a direct client upload into the bucket, so no
-- recording of a child is ever stored. Adults (a birthdate on file and 18+)
-- are unchanged; an athlete with no birthdate counts as a minor (D8).
DROP POLICY IF EXISTS "Room participants can upload voice notes" ON storage.objects;

CREATE POLICY "Room participants can upload voice notes"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'voice-notes'
  AND public.is_room_participant(((storage.foldername(name))[1])::uuid, auth.uid())
  AND NOT EXISTS (
    SELECT 1
    FROM public.athletes a
    WHERE a.user_id = auth.uid()
      AND (a.birthdate IS NULL OR a.birthdate > (current_date - interval '18 years'))
  )
);
