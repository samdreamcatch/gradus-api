
CREATE TABLE public.lifecycle_email_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('welcome','activation')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind)
);

CREATE INDEX lifecycle_email_jobs_pending_idx ON public.lifecycle_email_jobs (status, created_at);

GRANT ALL ON public.lifecycle_email_jobs TO service_role;
GRANT SELECT ON public.lifecycle_email_jobs TO authenticated;

ALTER TABLE public.lifecycle_email_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read lifecycle email jobs"
  ON public.lifecycle_email_jobs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER lifecycle_email_jobs_touch
  BEFORE UPDATE ON public.lifecycle_email_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Central enqueue helper: "send once, ever" is enforced by the unique constraint.
CREATE OR REPLACE FUNCTION public.enqueue_lifecycle_email(_user_id uuid, _kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.lifecycle_email_jobs (user_id, kind)
  VALUES (_user_id, _kind)
  ON CONFLICT (user_id, kind) DO NOTHING;
END;
$$;

-- Welcome triggers -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifecycle_welcome_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.is_test, false) THEN
    RETURN NEW;
  END IF;
  PERFORM public.enqueue_lifecycle_email(NEW.user_id, 'welcome');
  RETURN NEW;
END;
$$;

CREATE TRIGGER lifecycle_welcome_coach
  AFTER INSERT ON public.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION public.lifecycle_welcome_from_profile();

CREATE TRIGGER lifecycle_welcome_parent
  AFTER INSERT ON public.parent_profiles
  FOR EACH ROW EXECUTE FUNCTION public.lifecycle_welcome_from_profile();

CREATE OR REPLACE FUNCTION public.lifecycle_welcome_from_athlete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.is_test, false) OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM public.enqueue_lifecycle_email(NEW.user_id, 'welcome');
  RETURN NEW;
END;
$$;

CREATE TRIGGER lifecycle_welcome_athlete_insert
  AFTER INSERT ON public.athletes
  FOR EACH ROW EXECUTE FUNCTION public.lifecycle_welcome_from_athlete();

CREATE TRIGGER lifecycle_welcome_athlete_claim
  AFTER UPDATE OF user_id ON public.athletes
  FOR EACH ROW WHEN (NEW.user_id IS NOT NULL AND OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION public.lifecycle_welcome_from_athlete();

-- Activation triggers ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifecycle_activation_from_coach_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coach_user uuid;
  v_athlete_user uuid;
  v_parent_user uuid;
  v_test boolean;
BEGIN
  SELECT cp.user_id, COALESCE(cp.is_test, false)
    INTO v_coach_user, v_test
    FROM public.coach_profiles cp WHERE cp.id = NEW.coach_id;
  IF NOT COALESCE(v_test, false) THEN
    PERFORM public.enqueue_lifecycle_email(v_coach_user, 'activation');
  END IF;

  SELECT a.user_id, pp.user_id, COALESCE(a.is_test, false)
    INTO v_athlete_user, v_parent_user, v_test
    FROM public.athletes a
    LEFT JOIN public.parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = NEW.athlete_id;

  IF NOT COALESCE(v_test, false) THEN
    PERFORM public.enqueue_lifecycle_email(v_athlete_user, 'activation');
    PERFORM public.enqueue_lifecycle_email(v_parent_user, 'activation');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER lifecycle_activation_coach_athlete
  AFTER INSERT ON public.coach_athletes
  FOR EACH ROW EXECUTE FUNCTION public.lifecycle_activation_from_coach_link();

CREATE OR REPLACE FUNCTION public.lifecycle_activation_from_parent_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_user uuid;
BEGIN
  IF COALESCE(NEW.is_test, false) OR NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT pp.user_id INTO v_parent_user FROM public.parent_profiles pp WHERE pp.id = NEW.parent_id;
  PERFORM public.enqueue_lifecycle_email(v_parent_user, 'activation');
  PERFORM public.enqueue_lifecycle_email(NEW.user_id, 'activation');
  RETURN NEW;
END;
$$;

CREATE TRIGGER lifecycle_activation_parent_athlete_insert
  AFTER INSERT ON public.athletes
  FOR EACH ROW EXECUTE FUNCTION public.lifecycle_activation_from_parent_link();

CREATE TRIGGER lifecycle_activation_parent_athlete_update
  AFTER UPDATE OF parent_id ON public.athletes
  FOR EACH ROW WHEN (NEW.parent_id IS NOT NULL AND OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION public.lifecycle_activation_from_parent_link();
