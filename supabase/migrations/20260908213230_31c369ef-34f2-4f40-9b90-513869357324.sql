-- Close a double-billing race in createInvoice() (src/lib/invoicing.server.ts),
-- flagged in review of the I11 invoicing wave: the only DB uniqueness on
-- invoice_lines (invoice_lines_unique_occurrence_idx, in
-- 20260808215250_*.sql) is scoped to a single invoice_id, so two concurrent
-- creates for the same athlete (e.g. a client retry using a fresh
-- Idempotency-Key each attempt) can both pass the "already billed"
-- read-then-insert check before either has inserted, and both end up
-- billing the same lesson date onto two different invoices.
--
-- Denormalize coach_id/athlete_id onto invoice_lines (kept in sync by a
-- trigger, so application code never has to set them) so one unique index
-- can span every invoice for that athlete, not just one.
ALTER TABLE public.invoice_lines
  ADD COLUMN coach_id uuid REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  ADD COLUMN athlete_id uuid REFERENCES public.athletes(id) ON DELETE CASCADE;

UPDATE public.invoice_lines il
SET coach_id = i.coach_id, athlete_id = i.athlete_id
FROM public.invoices i
WHERE i.id = il.invoice_id;

ALTER TABLE public.invoice_lines
  ALTER COLUMN coach_id SET NOT NULL,
  ALTER COLUMN athlete_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.set_invoice_line_billing_ids()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  SELECT coach_id, athlete_id INTO NEW.coach_id, NEW.athlete_id
  FROM public.invoices WHERE id = NEW.invoice_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_lines_set_billing_ids ON public.invoice_lines;
CREATE TRIGGER invoice_lines_set_billing_ids
  BEFORE INSERT OR UPDATE OF invoice_id ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_line_billing_ids();

-- Global per-athlete uniqueness: a given occurrence date (and slot, so two
-- different lessons on the same day still each get a line) may only ever
-- appear on one invoice for that athlete, across all of the coach's
-- invoices — not just within a single invoice_id. A concurrent second
-- insert for the same date now fails with 23505 instead of succeeding onto
-- a second invoice; createInvoice() (src/lib/invoicing.server.ts) turns
-- that into the same "Those sessions have already been invoiced." error the
-- pre-check already gives the non-concurrent case.
CREATE UNIQUE INDEX invoice_lines_unique_athlete_occurrence_idx
  ON public.invoice_lines (
    coach_id,
    athlete_id,
    occurrence_date,
    COALESCE(slot_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );