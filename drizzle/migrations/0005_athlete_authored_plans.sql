-- AP1: athlete-authored plans (PRD §6.14 and §10.10, decision #35).
--
-- An athlete can create, edit, activate, bench and delete their own practice
-- plans. A self-authored plan is `kind = 'plan'`, `source = 'athlete'`,
-- `coach_id NULL`, `athlete_id` = the author. Coaches never own these rows;
-- they appear to the athlete's rostered coaches and guardians read-only, and
-- they are never assigned to anyone.
--
-- Additive and safe to apply before the code that uses it: nothing writes
-- `source = 'athlete'` until the AP2 routes exist, and every existing row
-- keeps passing every constraint below.
--
-- What this file does:
--   1. widens `plans_source_check` to admit 'athlete';
--   2. replaces `plans_coachless_must_be_gradus` with a version that admits
--      'athlete' too, and pins the shape of an athlete-authored row;
--   3. teaches the ownership trigger (shared by plans, moves and resources) the
--      same rule, from its latest definition, 20260813005509;
--   4. adds the athlete read/write policies on `plans` and `plan_moves`, plus
--      read access for coaches rostered to the author;
--   5. gives `can_view_plan` (the `plan_moves` read gate) the same two reads;
--   6. adds the athlete branch to `import_shared_plan`;
--   7. adds the author to `get_shared_plan` ("Plan by <first name>").

/* ------------------------------------------------------------ constraints */

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_source_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_source_check
  CHECK (source IN ('coach', 'gradus', 'competition', 'athlete'));

-- A plan with no coach must come from Gradus or from the athlete. (The old
-- constraint only knew 'gradus'; dropping it first is safe, every existing
-- row satisfies the looser rule.)
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_coachless_must_be_gradus;
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_coachless_must_be_gradus_or_athlete;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_coachless_must_be_gradus_or_athlete
  CHECK (coach_id IS NOT NULL OR source IN ('gradus', 'athlete')) NOT VALID;
ALTER TABLE public.plans VALIDATE CONSTRAINT plans_coachless_must_be_gradus_or_athlete;

-- The shape of a self-authored plan: always a plan (never a template), always
-- tied to its athlete, never to a coach or an organization. This is what
-- stops an athlete from relabelling a coach's plan or forging coach ownership
-- through a direct write.
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_athlete_source_shape;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_athlete_source_shape
  CHECK (
    source <> 'athlete'
    OR (
      kind = 'plan'
      AND athlete_id IS NOT NULL
      AND coach_id IS NULL
      AND is_org_template = false
      AND organization_id IS NULL
    )
  ) NOT VALID;
ALTER TABLE public.plans VALIDATE CONSTRAINT plans_athlete_source_shape;

/* ---------------------------------------------------------------- trigger */

-- The 20260813005509 body, unchanged except that a coach-less PLAN may also come
-- from the athlete. (`NEW.source` is read only inside the plans branch: moves and
-- resources have no such column, and this one function serves all three tables.)
CREATE OR REPLACE FUNCTION public.validate_org_template_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_org_template THEN
    IF NEW.organization_id IS NULL THEN
      RAISE EXCEPTION 'Org templates require organization_id';
    END IF;
    IF NEW.coach_id IS NOT NULL THEN
      RAISE EXCEPTION 'Org templates must not set coach_id';
    END IF;
  ELSE
    IF NEW.coach_id IS NULL THEN
      IF TG_TABLE_NAME = 'plans' THEN
        IF NEW.source NOT IN ('gradus', 'athlete') THEN
          RAISE EXCEPTION 'coach_id is required for non-template plans';
        END IF;
      ELSIF TG_TABLE_NAME = 'moves' THEN
        RAISE EXCEPTION 'coach_id is required for non-template moves';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

/* ---------------------------------------------------------------- helpers */

-- Is this athlete paused (Apple withdrew parental consent, §6.13)? Judged per
-- USER, not per row: an existing policy lets a signed-in user add another
-- athletes row for themselves, and a paused account must not escape the pause
-- by opening a fresh, active one.
CREATE OR REPLACE FUNCTION public.is_athlete_paused(_athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.athletes a
    WHERE a.account_state = 'paused'
      AND (
        a.id = _athlete_id
        OR (a.user_id IS NOT NULL
            AND a.user_id = (SELECT x.user_id FROM public.athletes x WHERE x.id = _athlete_id))
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.is_athlete_paused(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_athlete_paused(uuid) TO authenticated, service_role;

-- Is the caller this athlete? With `_must_be_active`, a paused athlete counts as
-- nobody: they keep read access to what they already have, but write nothing new.
CREATE OR REPLACE FUNCTION public.is_own_athlete(_athlete_id uuid, _must_be_active boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.athletes a
    WHERE a.id = _athlete_id
      AND a.user_id = (SELECT auth.uid())
      AND (NOT _must_be_active OR NOT public.is_athlete_paused(a.id))
  );
$function$;

REVOKE ALL ON FUNCTION public.is_own_athlete(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_own_athlete(uuid, boolean) TO authenticated, service_role;

-- Is this a self-authored plan the caller may change?
CREATE OR REPLACE FUNCTION public.is_own_authored_plan(_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.plans p
    WHERE p.id = _plan_id
      AND p.source = 'athlete'
      AND p.kind = 'plan'
      AND public.is_own_athlete(p.athlete_id, true)
  );
$function$;

REVOKE ALL ON FUNCTION public.is_own_authored_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_own_authored_plan(uuid) TO authenticated, service_role;

/* --------------------------------------------------------- plans policies */

-- The author reads their own plans in every status, drafts included (the
-- existing "Athletes view own plans" policy only shows active and benched).
DROP POLICY IF EXISTS "Athletes view own authored plans" ON public.plans;
CREATE POLICY "Athletes view own authored plans"
  ON public.plans FOR SELECT
  TO authenticated
  USING (
    source = 'athlete'
    AND kind = 'plan'
    AND public.is_own_athlete(athlete_id)
  );

DROP POLICY IF EXISTS "Athletes insert own authored plans" ON public.plans;
CREATE POLICY "Athletes insert own authored plans"
  ON public.plans FOR INSERT
  TO authenticated
  WITH CHECK (
    source = 'athlete'
    AND kind = 'plan'
    AND coach_id IS NULL
    AND public.is_own_athlete(athlete_id, true)
  );

DROP POLICY IF EXISTS "Athletes update own authored plans" ON public.plans;
CREATE POLICY "Athletes update own authored plans"
  ON public.plans FOR UPDATE
  TO authenticated
  USING (
    source = 'athlete'
    AND kind = 'plan'
    AND public.is_own_athlete(athlete_id, true)
  )
  WITH CHECK (
    source = 'athlete'
    AND kind = 'plan'
    AND coach_id IS NULL
    AND public.is_own_athlete(athlete_id, true)
  );

DROP POLICY IF EXISTS "Athletes delete own authored plans" ON public.plans;
CREATE POLICY "Athletes delete own authored plans"
  ON public.plans FOR DELETE
  TO authenticated
  USING (
    source = 'athlete'
    AND kind = 'plan'
    AND public.is_own_athlete(athlete_id, true)
  );

-- A coach rostered to the athlete sees their self-authored plans, read-only,
-- while they are active or benched (an unfinished draft stays private). The
-- same shape as the existing policy for Gradus starter plans.
DROP POLICY IF EXISTS "Coaches view athlete-authored plans for rostered athletes" ON public.plans;
CREATE POLICY "Coaches view athlete-authored plans for rostered athletes"
  ON public.plans FOR SELECT
  TO authenticated
  USING (
    source = 'athlete'
    AND kind = 'plan'
    AND status = ANY (ARRAY['active', 'benched'])
    AND EXISTS (
      SELECT 1
      FROM public.coach_athletes ca
      WHERE ca.athlete_id = plans.athlete_id
        AND ca.coach_id = public.my_coach_id()
    )
  );

-- (Guardians already read an athlete's active and benched plans through
-- "Parents view plans for own athletes", whatever the source.)

/* --------------------------------------------------- plan_moves policies */

DROP POLICY IF EXISTS "Athletes insert own authored plan_moves" ON public.plan_moves;
-- An athlete has no personal library, so a self-authored move never carries a
-- `move_id` (a coach importing the plan would otherwise follow it into another
-- coach's library).
CREATE POLICY "Athletes insert own authored plan_moves"
  ON public.plan_moves FOR INSERT
  TO authenticated
  WITH CHECK (public.is_own_authored_plan(plan_id) AND move_id IS NULL);

DROP POLICY IF EXISTS "Athletes update own authored plan_moves" ON public.plan_moves;
CREATE POLICY "Athletes update own authored plan_moves"
  ON public.plan_moves FOR UPDATE
  TO authenticated
  USING (public.is_own_authored_plan(plan_id))
  WITH CHECK (public.is_own_authored_plan(plan_id) AND move_id IS NULL);

DROP POLICY IF EXISTS "Athletes delete own authored plan_moves" ON public.plan_moves;
CREATE POLICY "Athletes delete own authored plan_moves"
  ON public.plan_moves FOR DELETE
  TO authenticated
  USING (public.is_own_authored_plan(plan_id));

-- plan_moves are read through can_view_plan(): the same two reads as above,
-- added to the existing function (every other clause is unchanged).
CREATE OR REPLACE FUNCTION public.can_view_plan(_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.plans p
    WHERE p.id = _plan_id
      AND (
        -- owning coach
        EXISTS (SELECT 1 FROM public.coach_profiles cp
                WHERE cp.id = p.coach_id AND cp.user_id = (SELECT auth.uid()))
        -- athlete viewing their own active/benched plan
        OR (p.kind = 'plan' AND p.status = ANY (ARRAY['active','benched'])
            AND EXISTS (SELECT 1 FROM public.athletes a
                        WHERE a.id = p.athlete_id AND a.user_id = (SELECT auth.uid())))
        -- athlete viewing a plan they wrote themselves, in any status
        OR (p.source = 'athlete' AND p.kind = 'plan'
            AND public.is_own_athlete(p.athlete_id))
        -- parent/guardian of the athlete
        OR (p.kind = 'plan' AND p.status = ANY (ARRAY['active','benched'])
            AND p.athlete_id IS NOT NULL
            AND public.is_parent_of_athlete(p.athlete_id))
        -- coach rostered to the athlete viewing a Gradus starter plan
        OR (p.source = 'gradus' AND p.kind = 'plan'
            AND p.status = ANY (ARRAY['active','benched'])
            AND EXISTS (SELECT 1 FROM public.coach_athletes ca
                        WHERE ca.athlete_id = p.athlete_id
                          AND ca.coach_id = public.my_coach_id()))
        -- coach rostered to the athlete viewing a plan the athlete wrote
        OR (p.source = 'athlete' AND p.kind = 'plan'
            AND p.status = ANY (ARRAY['active','benched'])
            AND EXISTS (SELECT 1 FROM public.coach_athletes ca
                        WHERE ca.athlete_id = p.athlete_id
                          AND ca.coach_id = public.my_coach_id()))
        -- linked coach via parent-granted visibility
        OR public.can_view_shared_coach_plan(p.coach_id, p.athlete_id)
      )
  );
$function$;

/* --------------------------------------------------------------- sharing */

-- Public read. The same snapshot as before, plus the author: `authorKind` is
-- 'coach' or 'athlete' and `authorFirstName` is that author's first name
-- (athlete first names only, nothing else about them). `coachFirstName` and
-- `coachLastName` keep their old meaning so nothing that reads them changes.
-- A plan whose athlete is paused (§6.13) stops resolving, as if unshared.
CREATE OR REPLACE FUNCTION public.get_shared_plan(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _plan record;
  _coach record;
  _athlete record;
  _moves jsonb;
  _kind text;
  _author_first text;
  _coach_last text := '';
BEGIN
  IF _token IS NULL OR length(_token) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT id, coach_id, athlete_id, source, title, notes, shared_at
    INTO _plan
  FROM plans
  WHERE share_token = _token
  LIMIT 1;

  IF _plan.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF _plan.source = 'athlete' THEN
    SELECT first_name INTO _athlete FROM athletes WHERE id = _plan.athlete_id;
    IF _athlete.first_name IS NULL OR is_athlete_paused(_plan.athlete_id) THEN
      RETURN NULL;
    END IF;
    _kind := 'athlete';
    _author_first := _athlete.first_name;
  ELSE
    SELECT first_name, last_name INTO _coach FROM coach_profiles WHERE id = _plan.coach_id;
    _kind := 'coach';
    _author_first := COALESCE(_coach.first_name, 'A Gradus coach');
    _coach_last := COALESCE(_coach.last_name, '');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'position', pm.position,
        'name', pm.name,
        'description', pm.description,
        'cue', pm.cue,
        'why', pm.why,
        'targetKind', pm.target_kind,
        'targetValue', pm.target_value
      )
      ORDER BY pm.position
    ),
    '[]'::jsonb
  )
  INTO _moves
  FROM plan_moves pm
  WHERE pm.plan_id = _plan.id;

  RETURN jsonb_build_object(
    'title', _plan.title,
    'notes', _plan.notes,
    'sharedAt', _plan.shared_at,
    'authorKind', _kind,
    'authorFirstName', _author_first,
    'coachFirstName', CASE WHEN _kind = 'athlete' THEN '' ELSE _author_first END,
    'coachLastName', _coach_last,
    'moves', _moves
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_plan(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_plan(text) TO anon, authenticated, service_role;

-- Import. Coaches: unchanged (a benched template in their library, missing
-- library moves materialized). Athletes: a copy snapshot of the plan that
-- lands ACTIVE as the athlete's own plan; moves copy as plain rows because
-- athletes have no personal move library. A coach who is also an athlete
-- imports as a coach. Anyone else is refused.
CREATE OR REPLACE FUNCTION public.import_shared_plan(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _src_plan record;
  _importer_coach_id uuid;
  _importer_athlete_id uuid;
  _src_author_first text;
  _src_athlete record;
  _new_plan_id uuid;
  _new_title text;
  _row record;
  _target_move_id uuid;
  _src_sport text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO _importer_coach_id
  FROM coach_profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF _importer_coach_id IS NULL THEN
    SELECT id INTO _importer_athlete_id
    FROM athletes
    WHERE user_id = auth.uid()
    ORDER BY created_at, id
    LIMIT 1;

    IF _importer_athlete_id IS NULL THEN
      RAISE EXCEPTION 'Only coaches and athletes can save shared plans' USING ERRCODE = '42501';
    END IF;
    -- A paused athlete saves nothing new, whichever of their rows is asked.
    IF is_athlete_paused(_importer_athlete_id) THEN
      RAISE EXCEPTION 'This account is paused' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT id, coach_id, athlete_id, source, title, notes
    INTO _src_plan
  FROM plans
  WHERE share_token = _token
  LIMIT 1;

  IF _src_plan.id IS NULL THEN
    RAISE EXCEPTION 'Shared plan not found' USING ERRCODE = 'P0002';
  END IF;

  IF _src_plan.source = 'athlete' THEN
    SELECT first_name INTO _src_athlete FROM athletes WHERE id = _src_plan.athlete_id;
    -- A paused athlete's links stop working (get_shared_plan says the same).
    IF _src_athlete.first_name IS NULL OR is_athlete_paused(_src_plan.athlete_id) THEN
      RAISE EXCEPTION 'Shared plan not found' USING ERRCODE = 'P0002';
    END IF;
    _src_author_first := _src_athlete.first_name;
    _new_title := COALESCE(NULLIF(_src_plan.title, ''), 'Untitled plan')
                  || ' (from ' || _src_author_first || ')';
  ELSE
    SELECT first_name INTO _src_author_first FROM coach_profiles WHERE id = _src_plan.coach_id;
    _new_title := COALESCE(NULLIF(_src_plan.title, ''), 'Untitled plan')
                  || ' (from Coach ' || COALESCE(_src_author_first, 'Gradus') || ')';
  END IF;

  IF _importer_coach_id IS NOT NULL THEN
    INSERT INTO plans (coach_id, title, notes, kind, athlete_id, status)
    VALUES (_importer_coach_id, _new_title, _src_plan.notes, 'template', NULL, 'benched')
    RETURNING id INTO _new_plan_id;
  ELSE
    INSERT INTO plans (coach_id, title, notes, kind, athlete_id, status, source)
    VALUES (NULL, _new_title, _src_plan.notes, 'plan', _importer_athlete_id, 'active', 'athlete')
    RETURNING id INTO _new_plan_id;
  END IF;

  FOR _row IN
    SELECT pm.position, pm.move_id, pm.name, pm.description, pm.cue, pm.why,
           pm.target_kind, pm.target_value
    FROM plan_moves pm
    WHERE pm.plan_id = _src_plan.id
    ORDER BY pm.position
  LOOP
    _target_move_id := NULL;
    _src_sport := NULL;

    -- Only follow a move into the SOURCE coach's own library: a plan_move's
    -- move_id is not otherwise vouched for.
    IF _importer_coach_id IS NOT NULL AND _row.move_id IS NOT NULL THEN
      SELECT sport INTO _src_sport
      FROM moves
      WHERE id = _row.move_id
        AND coach_id IS NOT DISTINCT FROM _src_plan.coach_id;
    END IF;

    IF _src_sport IS NOT NULL THEN
      SELECT id INTO _target_move_id
      FROM moves
      WHERE coach_id = _importer_coach_id
        AND sport = _src_sport
        AND lower(name) = lower(_row.name)
      LIMIT 1;

      IF _target_move_id IS NULL THEN
        INSERT INTO moves (coach_id, sport, category, name, description, cue, why,
                           default_target_kind, default_target_value)
        SELECT _importer_coach_id, m.sport, m.category, m.name, m.description, m.cue, m.why,
               m.default_target_kind, m.default_target_value
        FROM moves m
        WHERE m.id = _row.move_id
          AND m.coach_id IS NOT DISTINCT FROM _src_plan.coach_id
        RETURNING id INTO _target_move_id;
      END IF;
    END IF;

    INSERT INTO plan_moves (plan_id, position, move_id, name, description, cue, why,
                            target_kind, target_value)
    VALUES (_new_plan_id, _row.position, _target_move_id, _row.name, _row.description,
            _row.cue, _row.why, _row.target_kind, _row.target_value);
  END LOOP;

  RETURN _new_plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_shared_plan(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_shared_plan(text) TO authenticated, service_role;
