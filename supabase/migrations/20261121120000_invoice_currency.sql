-- Invoice currency (decision #69): one per coach, set in Settings, and kept
-- on each invoice. Display only: nothing is converted and no payment depends
-- on it. US dollar, Canadian dollar, Australian dollar, New Zealand dollar and
-- British pound for now (all two-decimal, dot-decimal, symbol first); the same
-- list is in src/lib/invoice-currency.ts, and adding a currency means widening
-- the one check constraint below (on coach_profiles) in a later migration.
--
-- Safe before or after the code deploy: the server reads the two columns with
-- their own guarded selects, never names invoices.currency on insert (the
-- trigger below sets it), and answers 503 to the Settings write until
-- coach_profiles.invoice_currency exists.
--
-- Additive only: no policy, grant, or existing column changes. Both tables
-- already have RLS and table-level grants, which cover a new column.
--
-- Cost on production data: a column added with a constant default is a
-- catalog change (no table rewrite); validating the check constraint scans
-- coach_profiles once under the ALTER's lock. The table is small.

-- 1. The coach's setting ---------------------------------------------------
-- Written by the coach through their own session: "Coaches can update own
-- profile" (USING and WITH CHECK auth.uid() = user_id) is the only UPDATE
-- policy on coach_profiles, so a coach reaches their own row and nobody
-- else's. The two column guards on the table, protect_coach_profile_columns
-- and protect_coach_billing_columns, are deny-lists of server-only billing and
-- membership columns; this column is deliberately on neither. Despite the
-- table's other "billing" columns, it has nothing to do with the Gradus
-- subscription: it is what the coach bills families in.
ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS invoice_currency text NOT NULL DEFAULT 'USD'
    CONSTRAINT coach_profiles_invoice_currency_check
    CHECK (invoice_currency IN ('USD', 'CAD', 'AUD', 'NZD', 'GBP'));

COMMENT ON COLUMN public.coach_profiles.invoice_currency IS
  'ISO 4217 code the coach invoices families in (decision #69). Set by the coach in Settings; display only, never converted. Not a Gradus subscription field.';

-- 2. Each invoice keeps its currency ----------------------------------------
-- Every invoice written before this migration was in US dollars, so the
-- default makes that explicit on the existing rows.
--
-- No check constraint of its own, on purpose: the trigger below is the only
-- writer and copies a value coach_profiles has already checked, so a second
-- list here would protect nothing and would have to be widened in step with
-- the first (miss it once and every invoice for a coach in the new currency
-- fails to insert).
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

COMMENT ON COLUMN public.invoices.currency IS
  'ISO 4217 code this invoice was created in: the coach''s invoice_currency at that moment, set by the invoices_set_currency trigger and never changed afterwards. Display only.';

-- 3. The database sets it, not the client ------------------------------------
-- On INSERT the currency is the coach's setting whatever the client sent, so
-- application code never names the column (precedent: the
-- invoice_lines_set_billing_ids trigger) and a caller writing through
-- PostgREST cannot stamp a currency of their choosing. On an UPDATE that
-- names the column the stored value is kept: an invoice stays in the currency
-- it was created in after the coach switches.
--
-- SECURITY DEFINER on purpose, unlike set_invoice_line_billing_ids: the value
-- must be the coach's real setting whoever performs the insert. As INVOKER
-- the lookup would run under the caller's RLS on coach_profiles, and a caller
-- who cannot see that row (any future writer other than the coach) would
-- silently get the fallback instead. It grants nothing: it reads one
-- non-secret column of the row NEW.coach_id points at, writes only NEW, and
-- returns nothing to the caller; the row still has to pass the invoices
-- WITH CHECK policy and the coach_id foreign key afterwards. A coach_id with
-- no profile falls back to the default so those checks answer as they always
-- did, rather than a NOT NULL error from here.
--
-- Fixed, empty search_path: every name in the body is schema-qualified.
CREATE OR REPLACE FUNCTION public.set_invoice_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.currency := OLD.currency;
    RETURN NEW;
  END IF;

  NEW.currency := coalesce(
    (SELECT cp.invoice_currency
       FROM public.coach_profiles cp
      WHERE cp.id = NEW.coach_id),
    'USD'
  );
  RETURN NEW;
END;
$$;

-- A trigger function cannot be called directly, and firing a trigger needs no
-- EXECUTE privilege; revoked anyway (Supabase grants EXECUTE on new functions
-- to anon and authenticated by name) so the definer function is not exposed.
REVOKE ALL ON FUNCTION public.set_invoice_currency() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS invoices_set_currency ON public.invoices;
CREATE TRIGGER invoices_set_currency
  BEFORE INSERT OR UPDATE OF currency ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_currency();
