ALTER TABLE public.coach_athletes
  ADD COLUMN IF NOT EXISTS coach_ack_at timestamptz,
  ADD COLUMN IF NOT EXISTS other_ack_at timestamptz;

-- Backfill existing links so the celebration only fires for connections
-- created after this change.
UPDATE public.coach_athletes
SET coach_ack_at = COALESCE(coach_ack_at, now()),
    other_ack_at = COALESCE(other_ack_at, now())
WHERE coach_ack_at IS NULL OR other_ack_at IS NULL;