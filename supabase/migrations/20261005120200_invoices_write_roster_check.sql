-- Invoices stay on the coach's own roster, and their lines stay on the invoice.
--
-- 1. "Coaches manage own invoices" (FOR ALL) only checked that invoices.coach_id
--    belongs to the caller. A coach who knew an athlete's id could INSERT an
--    invoice for an athlete they do not coach, or UPDATE one of their own
--    invoices to point at one. Nobody but the writing coach can read an invoice
--    (there is no parent or athlete policy and no email or push), but the
--    retention sweep counts the newest invoices.updated_at for an athlete as
--    activity (src/lib/retention.server.ts, lastActivityAt), whichever coach
--    wrote it, so one stray invoice keeps a dormant minor's account from being
--    swept or cancels a pending deletion notice.
--
-- 2. "Coaches manage own invoice lines" (FOR ALL) only checked that the line's
--    invoice belongs to the caller. invoice_lines.coach_id and athlete_id are
--    copied from the invoice by a trigger that fires on INSERT and when
--    invoice_id is updated, so a plain UPDATE of coach_id/athlete_id on the
--    coach's own line was accepted. Pointing them at another coach's athlete
--    claims that coach's (coach, athlete, date, slot) key in
--    invoice_lines_unique_athlete_occurrence_idx, and the other coach's
--    createInvoice then fails with 23505 ("already invoiced") for that date.
--    Needs the other coach's id, the athlete's id and the lesson slot's id.
--
-- Invoices: INSERT needs a coach_athletes row for (coach_id, athlete_id). An
-- UPDATE needs the same unless it leaves athlete_id as it was, so a coach can
-- still mark an invoice paid, add lines or fix a total after the athlete has
-- left the roster (a late payment must still be recordable). Re-pointing an
-- invoice at an athlete who is not on the roster is refused.
--
-- "Leaves athlete_id as it was" has to read the row's earlier version, and a
-- policy cannot select from its own table (Postgres: infinite recursion
-- detected in policy), so the read lives in a small helper in the same shape as
-- caller_owns_coach. It runs against the statement's snapshot, which does not
-- yet hold the new row, and it answers only for the caller's own invoices, so
-- calling it directly says nothing a coach cannot already read. On INSERT there
-- is no earlier row, so a new invoice always needs the roster row.
--
-- Invoice lines: the line's coach_id and athlete_id must equal its invoice's.
-- The trigger runs before the check, so inserts and invoice_id moves already
-- satisfy it.
--
-- Left alone on purpose: SELECT and DELETE (USING), both USING clauses, the
-- coach_athlete_rates policy (a rate row for an athlete you do not coach is
-- readable by nobody else and feeds nothing), the line trigger, and existing
-- rows.
--
-- No existing function is replaced. Idempotent: safe to re-apply.

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
      EXISTS (
        SELECT 1 FROM public.coach_athletes ca
        WHERE ca.coach_id = invoices.coach_id AND ca.athlete_id = invoices.athlete_id
      )
      OR public.invoice_keeps_athlete(invoices.id, invoices.athlete_id)
    )
  );

DROP POLICY IF EXISTS "Coaches manage own invoice lines" ON public.invoice_lines;
CREATE POLICY "Coaches manage own invoice lines" ON public.invoice_lines
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id AND public.caller_owns_coach(i.coach_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id
        AND public.caller_owns_coach(i.coach_id)
        AND i.coach_id = invoice_lines.coach_id
        AND i.athlete_id = invoice_lines.athlete_id
    )
  );
