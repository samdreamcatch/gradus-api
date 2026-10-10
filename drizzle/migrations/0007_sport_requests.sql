-- "Request a sport" (beta feedback 2026-10-07, Mariah's call). Coaches can no
-- longer invent a custom sport: a typed sport made a key like
-- `custom_new_sport_c715f`, showed that key across the app, and let anyone
-- add any "sport" to a product that positions itself as the safe one.
-- Instead a coach who can't find their sport asks for it here, picks a listed
-- sport in the meantime, and Gradus adds real ones to the catalog.
--
-- One row per request. `POST /api/v1/sport-requests` (and the web's server
-- function) inserts through the service role and emails the team; Admin →
-- Leads lists the rows. Existing custom sports keep working unchanged.
--
-- Service role only: RLS on with no policies.
CREATE TABLE IF NOT EXISTS public.sport_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The caller's role when they asked ("coach", "athlete", …), from the same
  -- detection the feedback form uses.
  role text NOT NULL DEFAULT 'unknown',
  requested_sport text NOT NULL CHECK (char_length(requested_sport) BETWEEN 1 AND 80),
  -- Where they asked: coach sign-up, coach onboarding, or Settings.
  source text NOT NULL CHECK (source IN ('coach_signup', 'coach_onboarding', 'coach_settings')),
  -- An admin marks a request handled once the sport is added or declined.
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sport_requests_created_at_idx ON public.sport_requests (created_at DESC);

COMMENT ON TABLE public.sport_requests IS
  'Sports coaches asked Gradus to add (replaces custom sports, 2026-10-08). Inserted by the API; listed in Admin → Leads.';

ALTER TABLE public.sport_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sport_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sport_requests TO service_role;
