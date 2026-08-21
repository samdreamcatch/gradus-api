CREATE OR REPLACE FUNCTION public.is_privileged_writer()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_user IN ('service_role', 'postgres', 'supabase_admin')
     OR coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.protect_coach_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;
  NEW.user_id := OLD.user_id;
  NEW.entitlement := OLD.entitlement;
  NEW.subscription_tier := OLD.subscription_tier;
  NEW.subscription_status := OLD.subscription_status;
  NEW.subscription_environment := OLD.subscription_environment;
  NEW.trial_ends_at := OLD.trial_ends_at;
  NEW.current_period_end := OLD.current_period_end;
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.is_org_admin := OLD.is_org_admin;
  NEW.founding_coach := OLD.founding_coach;
  NEW.founding_pro_trial_used := OLD.founding_pro_trial_used;
  NEW.founding_pro_trial_started_at := OLD.founding_pro_trial_started_at;
  NEW.organization_id := OLD.organization_id;
  NEW.promo_code := OLD.promo_code;
  NEW.is_test := OLD.is_test;
  NEW.last_synced_content_version := OLD.last_synced_content_version;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_coach_profile_columns ON public.coach_profiles;
CREATE TRIGGER protect_coach_profile_columns
BEFORE UPDATE ON public.coach_profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_coach_profile_columns();

CREATE OR REPLACE FUNCTION public.protect_parent_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;
  NEW.user_id := OLD.user_id;
  NEW.coach_id := OLD.coach_id;
  NEW.promo_code := OLD.promo_code;
  NEW.is_test := OLD.is_test;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_parent_profile_columns ON public.parent_profiles;
CREATE TRIGGER protect_parent_profile_columns
BEFORE UPDATE ON public.parent_profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_parent_profile_columns();

DROP POLICY IF EXISTS "Coaches can update own profile" ON public.coach_profiles;
CREATE POLICY "Coaches can update own profile"
ON public.coach_profiles FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Parents can update own profile" ON public.parent_profiles;
CREATE POLICY "Parents can update own profile"
ON public.parent_profiles FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);