ALTER TABLE public.board_follows ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.board_follows ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE public.board_follows ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web';

ALTER TABLE public.board_follows DROP CONSTRAINT IF EXISTS board_follows_owner_present;
ALTER TABLE public.board_follows
  ADD CONSTRAINT board_follows_owner_present
  CHECK (user_id IS NOT NULL OR device_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS board_follows_device_unique_idx
  ON public.board_follows (device_id, competition_slug, skater_name)
  WHERE device_id IS NOT NULL AND user_id IS NULL;

CREATE INDEX IF NOT EXISTS board_follows_slug_idx
  ON public.board_follows (competition_slug);