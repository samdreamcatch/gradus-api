-- Helper: does the given coach_profiles.id belong to the caller?
CREATE OR REPLACE FUNCTION public.caller_owns_coach(_coach_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coach_profiles
    WHERE id = _coach_id AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.caller_owns_coach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_owns_coach(uuid) TO authenticated, service_role;

-- 1. Per-student rate ------------------------------------------------------
CREATE TABLE public.coach_athlete_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  rate_kind text NOT NULL CHECK (rate_kind IN ('per_session', 'hourly')),
  rate_cents integer NOT NULL CHECK (rate_cents >= 0 AND rate_cents <= 10000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id, athlete_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_athlete_rates TO authenticated;
GRANT ALL ON public.coach_athlete_rates TO service_role;

ALTER TABLE public.coach_athlete_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches manage own athlete rates"
  ON public.coach_athlete_rates FOR ALL
  TO authenticated
  USING (public.caller_owns_coach(coach_id))
  WITH CHECK (public.caller_owns_coach(coach_id));

CREATE TRIGGER update_coach_athlete_rates_updated_at
  BEFORE UPDATE ON public.coach_athlete_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Invoices ---------------------------------------------------------------
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invoices_coach_created_idx ON public.invoices (coach_id, created_at DESC);
CREATE INDEX invoices_coach_athlete_idx ON public.invoices (coach_id, athlete_id, period_end DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches manage own invoices"
  ON public.invoices FOR ALL
  TO authenticated
  USING (public.caller_owns_coach(coach_id))
  WITH CHECK (public.caller_owns_coach(coach_id));

CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Invoice lines ----------------------------------------------------------
CREATE TABLE public.invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  slot_id uuid REFERENCES public.athlete_lesson_slots(id) ON DELETE SET NULL,
  occurrence_date date NOT NULL,
  start_minute integer,
  end_minute integer,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  included_reason text NOT NULL DEFAULT 'completed'
    CHECK (included_reason IN ('completed', 'manual_add')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invoice_lines_invoice_idx ON public.invoice_lines (invoice_id);
CREATE UNIQUE INDEX invoice_lines_unique_occurrence_idx
  ON public.invoice_lines (invoice_id, occurrence_date, COALESCE(slot_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_lines TO authenticated;
GRANT ALL ON public.invoice_lines TO service_role;

ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches manage own invoice lines"
  ON public.invoice_lines FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id
        AND public.caller_owns_coach(i.coach_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id
        AND public.caller_owns_coach(i.coach_id)
    )
  );