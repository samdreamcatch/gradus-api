-- Marketplace plan views for the seller dashboard (src/lib/coach-dashboard.server.ts).
-- A view is someone other than the plan's coach opening its marketplace page
-- (`POST /api/v1/marketplace/plans/{id}/view`), counted once per person per
-- plan per day. plans.view_count is the running total the dashboard shows;
-- plan_views keeps each day's views so the dashboard can break them down by
-- week (views vs purchases, conversion).
--
-- Additive and safe for the live app: one new column with a default (every
-- existing plan starts at 0) and one new table. view_count is server-written
-- only (the trigger below), like the rating totals.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_view_count_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_view_count_check CHECK (view_count >= 0);

COMMENT ON COLUMN public.plans.view_count IS
  'Marketplace views: distinct people (not the coach) opening the plan, once per day each. Server-written only.';

CREATE TABLE IF NOT EXISTS public.plan_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.plans (id) ON DELETE CASCADE,
  viewer_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  viewed_on date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, viewer_user_id, viewed_on)
);

CREATE INDEX IF NOT EXISTS plan_views_plan_day_idx ON public.plan_views (plan_id, viewed_on);

-- Server-only: written and read with the service role (no user policies).
ALTER TABLE public.plan_views ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.plan_views TO service_role;

COMMENT ON TABLE public.plan_views IS
  'One row per person per marketplace plan per day they opened it (not the coach). Server-written only.';

-- view_count changes only through the server, like protect_plan_rating_totals.
CREATE OR REPLACE FUNCTION public.protect_plan_view_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_caller() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.view_count <> 0 THEN
      RAISE EXCEPTION 'Plan view counts are set by the server.' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.view_count IS DISTINCT FROM OLD.view_count THEN
    RAISE EXCEPTION 'Plan view counts are set by the server.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_plan_view_count ON public.plans;
CREATE TRIGGER protect_plan_view_count
  BEFORE INSERT OR UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.protect_plan_view_count();
