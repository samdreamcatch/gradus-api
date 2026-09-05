-- Live Board follows, per docs/ios/PRD.md §6.9 ("Follows stored locally
-- and, for signed-in users, in board_follows (new, additive) so push and
-- Live Activities can target them").
--
-- Skater names are matched by normalized name against IJS results, not a
-- foreign key — there is no durable "skater" row, only what a competition
-- snapshot happens to publish. Service-role-only: written and read
-- exclusively by the /api/v1 boards routes through the admin client — the
-- app never issues ad-hoc table queries (PRD §6.3).
CREATE TABLE IF NOT EXISTS public.board_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  competition_slug text NOT NULL,
  skater_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, competition_slug, skater_name)
);

CREATE INDEX IF NOT EXISTS board_follows_user_slug_idx
  ON public.board_follows (user_id, competition_slug);

GRANT ALL ON public.board_follows TO service_role;

ALTER TABLE public.board_follows ENABLE ROW LEVEL SECURITY;
-- No policies for anon or authenticated: only the /api/v1 server layer
-- (service role) ever reads or writes follows.
