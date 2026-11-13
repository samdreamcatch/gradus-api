ALTER TABLE public.org_coach_invites
  ADD COLUMN IF NOT EXISTS sports text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS levels jsonb NOT NULL DEFAULT '[]'::jsonb;