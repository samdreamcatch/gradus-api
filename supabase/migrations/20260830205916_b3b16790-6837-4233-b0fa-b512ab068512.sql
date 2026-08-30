-- 1. Coach identity can be detached from the profile so coaching history survives deletion.
ALTER TABLE public.coach_profiles ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.coach_profiles DROP CONSTRAINT IF EXISTS coach_profiles_user_id_fkey;
ALTER TABLE public.coach_profiles
  ADD CONSTRAINT coach_profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Direct rooms survive when one side's profile is removed.
ALTER TABLE public.direct_rooms DROP CONSTRAINT IF EXISTS direct_rooms_parent_id_fkey;
ALTER TABLE public.direct_rooms
  ADD CONSTRAINT direct_rooms_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES public.parent_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.direct_rooms DROP CONSTRAINT IF EXISTS direct_rooms_coach_id_fkey;
ALTER TABLE public.direct_rooms
  ADD CONSTRAINT direct_rooms_coach_id_fkey
  FOREIGN KEY (coach_id) REFERENCES public.coach_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.direct_rooms DROP CONSTRAINT IF EXISTS direct_rooms_coach_a_id_fkey;
ALTER TABLE public.direct_rooms
  ADD CONSTRAINT direct_rooms_coach_a_id_fkey
  FOREIGN KEY (coach_a_id) REFERENCES public.coach_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.direct_rooms DROP CONSTRAINT IF EXISTS direct_rooms_coach_b_id_fkey;
ALTER TABLE public.direct_rooms
  ADD CONSTRAINT direct_rooms_coach_b_id_fkey
  FOREIGN KEY (coach_b_id) REFERENCES public.coach_profiles(id) ON DELETE SET NULL;

-- 3. Message tombstones.
ALTER TABLE public.messages ALTER COLUMN sender_user_id DROP NOT NULL;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_sender_user_id_fkey;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_sender_user_id_fkey
  FOREIGN KEY (sender_user_id) REFERENCES auth.users(id)
  ON DELETE SET NULL
  NOT VALID;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sender_deleted_at timestamptz;

COMMENT ON COLUMN public.messages.sender_deleted_at IS
  'Set when the sender deleted their account. The row is retained with its content cleared so the remaining participants keep a coherent thread.';

CREATE OR REPLACE FUNCTION public.tombstone_message_on_sender_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.body := '';
  NEW.audio_url := NULL;
  NEW.duration_seconds := NULL;
  NEW.sender_deleted_at := COALESCE(NEW.sender_deleted_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tombstone_message_on_sender_delete ON public.messages;
CREATE TRIGGER tombstone_message_on_sender_delete
  BEFORE UPDATE OF sender_user_id ON public.messages
  FOR EACH ROW
  WHEN (OLD.sender_user_id IS NOT NULL AND NEW.sender_user_id IS NULL)
  EXECUTE FUNCTION public.tombstone_message_on_sender_delete();

-- 4. Deletion audit trail (no plaintext email).
CREATE TABLE IF NOT EXISTS public.deleted_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  role text NOT NULL,
  initiated_by text NOT NULL DEFAULT 'self',
  email_hash text,
  notes text,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.deleted_accounts TO authenticated;
GRANT ALL ON public.deleted_accounts TO service_role;

ALTER TABLE public.deleted_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view deletion audit"
  ON public.deleted_accounts FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));