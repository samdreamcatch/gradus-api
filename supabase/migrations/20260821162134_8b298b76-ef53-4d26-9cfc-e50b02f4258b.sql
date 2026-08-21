ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS free_access_until timestamptz;

CREATE OR REPLACE FUNCTION public.protect_coach_profile_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  NEW.free_access_until := OLD.free_access_until;
  RETURN NEW;
END;
$function$;