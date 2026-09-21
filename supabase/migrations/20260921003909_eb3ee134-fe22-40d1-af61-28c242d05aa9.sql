-- Goals history is trusted-server-only: RLS is on with no policies, and only
-- the admin client touches it. Grant the service role explicitly; no grants
-- for anon or authenticated.
GRANT ALL ON public.athlete_goals_history TO service_role;
