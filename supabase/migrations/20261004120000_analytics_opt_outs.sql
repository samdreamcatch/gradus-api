-- Usage-data consent and withdrawal (PRD decision #46, Mariah 2026-10-04).
--
-- There is no in-app analytics switch. Consent to usage-data collection is
-- part of accepting the Terms of Service and Privacy Policy at sign-up, and
-- the privacy policy (§2.4, §8) tells users to email support@gradussports.com
-- to withdraw it. Gradus honors a request by hand: an admin records it on the
-- user's admin page, which inserts a row here and deletes the account's
-- stored usage events. `POST /api/v1/analytics/events` accepts and discards
-- a withdrawn account's batches (src/lib/analytics.server.ts), so the app
-- needs no change and never sees an error.
--
-- Minor athletes' events carry no user id (§6.12), so a withdrawal for a
-- minor stops future collection only; nothing stored can be traced to them.
--
-- Also here (review 2026-10-04): deleting an account now clears `user_id`
-- on its usage events (FK ON DELETE SET NULL), so a deleted adult's events
-- survive only as de-identified counts, as the retention policy promises.
--
-- Service role only: RLS on with no policies.
CREATE TABLE IF NOT EXISTS public.analytics_opt_outs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  -- The admin who recorded the request (auth user id), for the audit trail.
  recorded_by uuid,
  -- Where the request came from ("email 2026-10-04"), never the email body.
  note text NOT NULL DEFAULT ''
);

COMMENT ON TABLE public.analytics_opt_outs IS
  'Accounts that withdrew consent to usage-data collection (privacy policy §2.4). The analytics endpoint discards their batches; the admin page writes and clears rows.';

ALTER TABLE public.analytics_opt_outs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_opt_outs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.analytics_opt_outs TO service_role;

-- Recording a withdrawal, in one transaction: the request row first (from
-- here on the endpoint discards the account's batches), then every stored
-- event carrying the account's user id. Returns how many events were deleted,
-- so the admin page reports what happened rather than what was intended.
CREATE OR REPLACE FUNCTION public.analytics_withdraw_consent(p_user_id uuid, p_recorded_by uuid, p_note text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  removed bigint;
BEGIN
  INSERT INTO public.analytics_opt_outs (user_id, recorded_by, note)
  VALUES (p_user_id, p_recorded_by, left(coalesce(p_note, ''), 200))
  ON CONFLICT (user_id) DO NOTHING;
  DELETE FROM public.analytics_events WHERE user_id = p_user_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_withdraw_consent(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_withdraw_consent(uuid, uuid, text) TO service_role;

-- Account deletion de-identifies usage events. Rows left behind by accounts
-- deleted before this constraint existed are cleared first so it validates.
UPDATE public.analytics_events e
SET user_id = NULL
WHERE e.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = e.user_id);

ALTER TABLE public.analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_user_id_fkey,
  ADD CONSTRAINT analytics_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- The cascade, the withdrawal delete, and the per-user report counts all
-- look events up by user id.
CREATE INDEX IF NOT EXISTS analytics_events_user_idx
  ON public.analytics_events (user_id) WHERE user_id IS NOT NULL;
