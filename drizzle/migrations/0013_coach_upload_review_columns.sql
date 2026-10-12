ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'released',
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.resources DROP CONSTRAINT IF EXISTS resources_review_state_check;
ALTER TABLE public.resources
  ADD CONSTRAINT resources_review_state_check
  CHECK (review_state IN ('released', 'pending_check', 'held'));

CREATE INDEX IF NOT EXISTS idx_resources_review_queue
  ON public.resources (review_state, created_at)
  WHERE review_state <> 'released';