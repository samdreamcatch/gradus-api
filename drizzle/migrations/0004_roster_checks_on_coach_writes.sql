DROP POLICY IF EXISTS "Coaches manage own plans - insert" ON public.plans;
CREATE POLICY "Coaches manage own plans - insert" ON public.plans
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = plans.coach_id AND cp.user_id = auth.uid())
    AND (plans.athlete_id IS NULL OR EXISTS (SELECT 1 FROM public.coach_athletes ca WHERE ca.coach_id = plans.coach_id AND ca.athlete_id = plans.athlete_id))
  );

DROP POLICY IF EXISTS "Coaches manage own plans - update" ON public.plans;
CREATE POLICY "Coaches manage own plans - update" ON public.plans
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = plans.coach_id AND cp.user_id = auth.uid()))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = plans.coach_id AND cp.user_id = auth.uid())
    AND (plans.athlete_id IS NULL OR EXISTS (SELECT 1 FROM public.coach_athletes ca WHERE ca.coach_id = plans.coach_id AND ca.athlete_id = plans.athlete_id))
  );

DROP POLICY IF EXISTS "Coach manages own practice targets" ON public.coach_athlete_practice_targets;
CREATE POLICY "Coach manages own practice targets" ON public.coach_athlete_practice_targets
  FOR ALL TO authenticated
  USING (public.caller_owns_coach(coach_id))
  WITH CHECK (
    public.caller_owns_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.coach_athletes ca WHERE ca.coach_id = coach_athlete_practice_targets.coach_id AND ca.athlete_id = coach_athlete_practice_targets.athlete_id)
  );

DROP POLICY IF EXISTS "Coaches can insert their own wrap-ups" ON public.lesson_wrap_ups;
CREATE POLICY "Coaches can insert their own wrap-ups" ON public.lesson_wrap_ups
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = lesson_wrap_ups.coach_id AND cp.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.coach_athletes ca WHERE ca.coach_id = lesson_wrap_ups.coach_id AND ca.athlete_id = lesson_wrap_ups.athlete_id)
  );

CREATE OR REPLACE FUNCTION public.invoice_keeps_athlete(_invoice_id uuid, _athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = _invoice_id
      AND i.athlete_id = _athlete_id
      AND public.caller_owns_coach(i.coach_id)
  );
$$;

REVOKE ALL ON FUNCTION public.invoice_keeps_athlete(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_keeps_athlete(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Coaches manage own invoices" ON public.invoices;
CREATE POLICY "Coaches manage own invoices" ON public.invoices
  FOR ALL TO authenticated
  USING (public.caller_owns_coach(coach_id))
  WITH CHECK (
    public.caller_owns_coach(coach_id)
    AND (
      EXISTS (SELECT 1 FROM public.coach_athletes ca WHERE ca.coach_id = invoices.coach_id AND ca.athlete_id = invoices.athlete_id)
      OR public.invoice_keeps_athlete(invoices.id, invoices.athlete_id)
    )
  );

DROP POLICY IF EXISTS "Coaches manage own invoice lines" ON public.invoice_lines;
CREATE POLICY "Coaches manage own invoice lines" ON public.invoice_lines
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_lines.invoice_id AND public.caller_owns_coach(i.coach_id)))
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id
        AND public.caller_owns_coach(i.coach_id)
        AND i.coach_id = invoice_lines.coach_id
        AND i.athlete_id = invoice_lines.athlete_id
    )
  );

REVOKE EXECUTE ON FUNCTION public.activate_plan(uuid) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Coaches manage own athlete rates" ON public.coach_athlete_rates;
CREATE POLICY "Coaches manage own athlete rates" ON public.coach_athlete_rates
  FOR ALL TO authenticated
  USING (public.caller_owns_coach(coach_id))
  WITH CHECK (
    public.caller_owns_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.coach_athletes ca WHERE ca.coach_id = coach_athlete_rates.coach_id AND ca.athlete_id = coach_athlete_rates.athlete_id)
  );

CREATE OR REPLACE FUNCTION public.clear_primary_coach_on_roster_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.athlete_primary_coaches
  WHERE athlete_id = OLD.athlete_id AND coach_id = OLD.coach_id;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.clear_primary_coach_on_roster_removal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clear_primary_coach_on_roster_removal_trg ON public.coach_athletes;
CREATE TRIGGER clear_primary_coach_on_roster_removal_trg
  AFTER DELETE ON public.coach_athletes
  FOR EACH ROW EXECUTE FUNCTION public.clear_primary_coach_on_roster_removal();