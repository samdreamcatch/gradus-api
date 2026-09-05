-- Billing and membership columns on coach_profiles and parent_profiles are
-- written only by the server (service role): Stripe webhooks, checkout,
-- subscription sync, admin tools, club join and exit. The row-level UPDATE
-- policies ("Coaches can update own profile", "Parents can update own
-- profile") cannot restrict which columns change, so until now a signed-in
-- user could PATCH their own row through PostgREST and grant themselves an
-- entitlement, a subscription, founding status, free access, org admin, or
-- team seats (Lovable schema review, 2026-09-05).
--
-- These triggers reject any change to those columns unless the caller is the
-- service role (or the postgres role used by migrations and the SQL editor).
-- Additive only: no policy, grant, or column changes. The server functions
-- that used to write these columns through the user-scoped client now use
-- the admin client (same PR), so web behavior is unchanged.
--
-- Rejections use SQLSTATE 42501 (insufficient_privilege), which PostgREST
-- maps to HTTP 403.
--
-- The helper functions are deliberately callable by anon/authenticated: a
-- trigger function runs with the privileges of the user performing the
-- write (not SECURITY DEFINER, on purpose — with SECURITY DEFINER
-- current_user would always be postgres and the guard would pass everyone).
-- They read nothing sensitive.

CREATE OR REPLACE FUNCTION public.is_service_caller()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT current_user IN ('postgres', 'service_role', 'supabase_admin')
      OR coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
$$;

-- Evaluates a column's DEFAULT expression as text (NULL when there is none),
-- so INSERT guards compare against the real default instead of a literal
-- that could drift from the schema.
CREATE OR REPLACE FUNCTION public.column_default_text(tbl regclass, col name)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  expr text;
  result text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO expr
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = tbl AND a.attname = col;
  IF expr IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT (' || expr || ')::text' INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_coach_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_caller() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.entitlement IS DISTINCT FROM public.column_default_text('public.coach_profiles', 'entitlement')
       OR NEW.subscription_tier IS NOT NULL
       OR NEW.subscription_status IS NOT NULL
       OR NEW.current_period_end IS NOT NULL
       OR NEW.founding_coach
       OR NEW.founding_pro_trial_started_at IS NOT NULL
       OR NEW.founding_pro_trial_used
       OR NEW.free_access_until IS NOT NULL
       OR NEW.trial_ends_at IS NOT NULL
       OR NEW.stripe_customer_id IS NOT NULL
       OR NEW.stripe_subscription_id IS NOT NULL
       OR NEW.subscription_environment IS NOT NULL
       OR NEW.promo_code IS NOT NULL
       OR NEW.organization_id IS NOT NULL
       OR NEW.is_org_admin THEN
      RAISE EXCEPTION 'Billing and membership fields on coach_profiles can only be set by the server'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.entitlement IS DISTINCT FROM OLD.entitlement
     OR NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
     OR NEW.founding_coach IS DISTINCT FROM OLD.founding_coach
     OR NEW.founding_pro_trial_started_at IS DISTINCT FROM OLD.founding_pro_trial_started_at
     OR NEW.founding_pro_trial_used IS DISTINCT FROM OLD.founding_pro_trial_used
     OR NEW.free_access_until IS DISTINCT FROM OLD.free_access_until
     OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.subscription_environment IS DISTINCT FROM OLD.subscription_environment
     OR NEW.promo_code IS DISTINCT FROM OLD.promo_code
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.is_org_admin IS DISTINCT FROM OLD.is_org_admin THEN
    RAISE EXCEPTION 'Billing and membership fields on coach_profiles can only be changed by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_parent_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_caller() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.subscription_status IS NOT NULL
       OR NEW.current_period_end IS NOT NULL
       OR NEW.stripe_customer_id IS NOT NULL
       OR NEW.stripe_subscription_id IS NOT NULL
       OR NEW.subscription_environment IS NOT NULL
       OR NEW.promo_code IS NOT NULL
       OR NEW.team_plan_seats::text IS DISTINCT FROM public.column_default_text('public.parent_profiles', 'team_plan_seats') THEN
      RAISE EXCEPTION 'Billing fields on parent_profiles can only be set by the server'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.subscription_environment IS DISTINCT FROM OLD.subscription_environment
     OR NEW.promo_code IS DISTINCT FROM OLD.promo_code
     OR NEW.team_plan_seats IS DISTINCT FROM OLD.team_plan_seats THEN
    RAISE EXCEPTION 'Billing fields on parent_profiles can only be changed by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_billing_columns_on_coach_profiles ON public.coach_profiles;
CREATE TRIGGER protect_billing_columns_on_coach_profiles
  BEFORE INSERT OR UPDATE ON public.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_coach_billing_columns();

DROP TRIGGER IF EXISTS protect_billing_columns_on_parent_profiles ON public.parent_profiles;
CREATE TRIGGER protect_billing_columns_on_parent_profiles
  BEFORE INSERT OR UPDATE ON public.parent_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_parent_billing_columns();