ALTER TABLE public.athlete_invite_codes ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE public.athlete_invite_codes ALTER COLUMN expires_at DROP DEFAULT;
UPDATE public.athlete_invite_codes SET expires_at = NULL;