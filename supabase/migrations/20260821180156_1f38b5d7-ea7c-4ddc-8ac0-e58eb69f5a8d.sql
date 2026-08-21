-- 1) Guardian membership
CREATE TABLE IF NOT EXISTS public.athlete_guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  parent_id uuid NOT NULL REFERENCES public.parent_profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'co' CHECK (role IN ('primary','co')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, parent_id)
);
CREATE INDEX IF NOT EXISTS athlete_guardians_parent_idx ON public.athlete_guardians(parent_id);
CREATE INDEX IF NOT EXISTS athlete_guardians_athlete_idx ON public.athlete_guardians(athlete_id);

GRANT SELECT ON public.athlete_guardians TO authenticated;
GRANT ALL ON public.athlete_guardians TO service_role;
ALTER TABLE public.athlete_guardians ENABLE ROW LEVEL SECURITY;

-- 2) Guardian invites (email token and/or share code)
CREATE TABLE IF NOT EXISTS public.guardian_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  invited_by_parent_id uuid NOT NULL REFERENCES public.parent_profiles(id) ON DELETE CASCADE,
  email citext,
  code text NOT NULL UNIQUE,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','revoked')),
  expires_at timestamptz,
  claimed_by uuid,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guardian_invites_athlete_idx ON public.guardian_invites(athlete_id);

GRANT SELECT ON public.guardian_invites TO authenticated;
GRANT ALL ON public.guardian_invites TO service_role;
ALTER TABLE public.guardian_invites ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS guardian_invites_updated_at ON public.guardian_invites;
CREATE TRIGGER guardian_invites_updated_at
BEFORE UPDATE ON public.guardian_invites
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Backfill existing parent relationships as primary guardians
INSERT INTO public.athlete_guardians (athlete_id, parent_id, role)
SELECT a.id, a.parent_id, 'primary'
FROM public.athletes a
WHERE a.parent_id IS NOT NULL
ON CONFLICT (athlete_id, parent_id) DO NOTHING;

-- 4) Family plan billing columns on parent_profiles (service-role writable only)
ALTER TABLE public.parent_profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_environment text,
  ADD COLUMN IF NOT EXISTS family_plan_seats integer NOT NULL DEFAULT 3;

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
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.subscription_status := OLD.subscription_status;
  NEW.current_period_end := OLD.current_period_end;
  NEW.subscription_environment := OLD.subscription_environment;
  NEW.family_plan_seats := OLD.family_plan_seats;
  RETURN NEW;
END;
$$;

-- 5) Access helpers widened to guardians
CREATE OR REPLACE FUNCTION public.parent_athlete_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT a.id
  FROM public.athletes a
  JOIN public.parent_profiles pp ON pp.id = a.parent_id
  WHERE pp.user_id = (SELECT auth.uid())
  UNION
  SELECT DISTINCT ag.athlete_id
  FROM public.athlete_guardians ag
  JOIN public.parent_profiles pp ON pp.id = ag.parent_id
  WHERE pp.user_id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_parent_of_athlete(_athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM athletes a
    JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = _athlete_id
      AND pp.user_id = (SELECT auth.uid())
  ) OR EXISTS (
    SELECT 1
    FROM athlete_guardians ag
    JOIN parent_profiles pp ON pp.id = ag.parent_id
    WHERE ag.athlete_id = _athlete_id
      AND pp.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.is_parent_of_plan(_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM plans p
    WHERE p.id = _plan_id
      AND p.athlete_id IS NOT NULL
      AND public.is_parent_of_athlete(p.athlete_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_room_participant(_room_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM message_rooms r
    LEFT JOIN coach_profiles cp ON cp.id = r.coach_id
    LEFT JOIN athletes a ON a.id = r.athlete_id
    LEFT JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE r.id = _room_id
      AND (
        cp.user_id = _user_id
        OR a.user_id = _user_id
        OR pp.user_id = _user_id
        OR EXISTS (
          SELECT 1
          FROM athlete_guardians ag
          JOIN parent_profiles gp ON gp.id = ag.parent_id
          WHERE ag.athlete_id = r.athlete_id
            AND gp.user_id = _user_id
        )
      )
  );
$$;

-- 6) Household subscription state + write gate
CREATE OR REPLACE FUNCTION public.family_plan_active(_athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.athletes a
    JOIN public.parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = _athlete_id
      AND pp.subscription_status IN ('active','trialing','past_due')
      AND (pp.current_period_end IS NULL OR pp.current_period_end > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.parent_can_write(_athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- primary parent always writes
    EXISTS (
      SELECT 1
      FROM public.athletes a
      JOIN public.parent_profiles pp ON pp.id = a.parent_id
      WHERE a.id = _athlete_id AND pp.user_id = (SELECT auth.uid())
    )
    OR (
      -- co-guardian writes only while the household plan is active
      EXISTS (
        SELECT 1
        FROM public.athlete_guardians ag
        JOIN public.parent_profiles pp ON pp.id = ag.parent_id
        WHERE ag.athlete_id = _athlete_id
          AND ag.role = 'co'
          AND pp.user_id = (SELECT auth.uid())
      )
      AND public.family_plan_active(_athlete_id)
    );
$$;

-- 7) RLS for the new tables (reads only; writes go through server functions)
DROP POLICY IF EXISTS "Guardians view guardian rows for their athletes" ON public.athlete_guardians;
CREATE POLICY "Guardians view guardian rows for their athletes"
ON public.athlete_guardians FOR SELECT TO authenticated
USING (public.is_parent_of_athlete(athlete_id) OR public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Guardians view invites for their athletes" ON public.guardian_invites;
CREATE POLICY "Guardians view invites for their athletes"
ON public.guardian_invites FOR SELECT TO authenticated
USING (public.is_parent_of_athlete(athlete_id) OR public.has_role((SELECT auth.uid()), 'admin'));