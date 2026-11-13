ALTER TABLE public.organizations ADD COLUMN contract_seat_rate_cents integer;
ALTER TABLE public.organizations ADD COLUMN contract_currency text NOT NULL DEFAULT 'usd';
ALTER TABLE public.organizations ADD CONSTRAINT club_contract_rate_nonnegative CHECK (contract_seat_rate_cents IS NULL OR contract_seat_rate_cents >= 0);
CREATE TABLE public.club_contract_trueups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id), actor_user_id uuid NOT NULL,
 request_key uuid NOT NULL, seats_added integer NOT NULL CHECK (seats_added > 0), rate_cents integer NOT NULL,
 amount_cents integer NOT NULL, currency text NOT NULL, effective_on date NOT NULL, contract_ends_on date NOT NULL,
 status text NOT NULL DEFAULT 'awaiting_invoice' CHECK (status IN ('awaiting_invoice','invoiced','paid','void')),
 invoice_reference text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,request_key)
);
GRANT SELECT ON public.club_contract_trueups TO authenticated;
GRANT ALL ON public.club_contract_trueups TO service_role;
ALTER TABLE public.club_contract_trueups ENABLE ROW LEVEL SECURITY;
CREATE POLICY club_trueups_read ON public.club_contract_trueups FOR SELECT TO authenticated USING (public.has_org_admin(auth.uid(),organization_id) OR public.has_role(auth.uid(),'admin'));
CREATE OR REPLACE FUNCTION public.club_expand_contract(p_org_id uuid,p_actor uuid,p_seats integer,p_expected_amount integer,p_request_key uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE c public.organizations; existing uuid; amount integer; today date := (now() AT TIME ZONE 'UTC')::date; new_id uuid;
BEGIN
 IF NOT public.has_org_admin(p_actor,p_org_id) THEN RAISE EXCEPTION 'Not authorized for this club'; END IF;
 SELECT * INTO c FROM public.organizations WHERE id=p_org_id FOR UPDATE;
 SELECT id INTO existing FROM public.club_contract_trueups WHERE organization_id=p_org_id AND request_key=p_request_key;
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 IF p_seats IS NULL OR p_seats < 1 OR p_seats > 1000 OR c.coach_seats+p_seats > 10000 THEN RAISE EXCEPTION 'Invalid seat increase'; END IF;
 IF c.contract_seat_rate_cents IS NULL OR c.contract_starts_on IS NULL OR c.contract_ends_on IS NULL THEN RAISE EXCEPTION 'Gradus must set the contract rate and term first'; END IF;
 IF today < c.contract_starts_on OR today > c.contract_ends_on THEN RAISE EXCEPTION 'The contract is not active'; END IF;
 amount := round(p_seats::numeric*c.contract_seat_rate_cents*(c.contract_ends_on-today+1)/(c.contract_ends_on-c.contract_starts_on+1));
 IF amount IS DISTINCT FROM p_expected_amount THEN RAISE EXCEPTION 'The quote changed. Review the cost again.'; END IF;
 INSERT INTO public.club_contract_trueups(organization_id,actor_user_id,request_key,seats_added,rate_cents,amount_cents,currency,effective_on,contract_ends_on)
 VALUES(p_org_id,p_actor,p_request_key,p_seats,c.contract_seat_rate_cents,amount,c.contract_currency,today,c.contract_ends_on) RETURNING id INTO new_id;
 UPDATE public.organizations SET coach_seats=coach_seats+p_seats WHERE id=p_org_id;
 INSERT INTO public.org_admin_actions(actor_user_id,organization_id,action,payload) VALUES(p_actor,p_org_id,'contract.seats_added',jsonb_build_object('trueupId',new_id,'seats',p_seats,'amountCents',amount));
 RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.club_expand_contract(uuid,uuid,integer,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.club_expand_contract(uuid,uuid,integer,integer,uuid) TO service_role;