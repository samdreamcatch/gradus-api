
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS card_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS applies_to_plans text[] NOT NULL DEFAULT ARRAY['coach','coach_pro']::text[];

-- Ensure only valid tier values
ALTER TABLE public.promo_codes DROP CONSTRAINT IF EXISTS promo_codes_applies_to_plans_check;
ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_applies_to_plans_check
  CHECK (
    array_length(applies_to_plans, 1) >= 1
    AND applies_to_plans <@ ARRAY['coach','coach_pro']::text[]
  );

-- Backfill sensible defaults for seeded rows
UPDATE public.promo_codes
   SET applies_to_plans = ARRAY['coach_pro']::text[],
       card_required = true
 WHERE code IN ('WILSON','PRACTICE','WELCOME_BACK');

UPDATE public.promo_codes
   SET applies_to_plans = ARRAY['coach']::text[],
       card_required = false
 WHERE code = 'FOUNDING_COACH';
