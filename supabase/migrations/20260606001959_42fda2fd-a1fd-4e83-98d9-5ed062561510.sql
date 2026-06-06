
DROP POLICY IF EXISTS "Uploader can update own voice notes" ON storage.objects;
DROP POLICY IF EXISTS "Uploader can delete own voice notes" ON storage.objects;

CREATE POLICY "Uploader can update own voice notes"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'voice-notes'
  AND is_room_participant(((storage.foldername(name))[1])::uuid, auth.uid())
  AND (storage.foldername(name))[2] = (auth.uid())::text
)
WITH CHECK (
  bucket_id = 'voice-notes'
  AND is_room_participant(((storage.foldername(name))[1])::uuid, auth.uid())
  AND (storage.foldername(name))[2] = (auth.uid())::text
);

CREATE POLICY "Uploader can delete own voice notes"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'voice-notes'
  AND is_room_participant(((storage.foldername(name))[1])::uuid, auth.uid())
  AND (storage.foldername(name))[2] = (auth.uid())::text
);
