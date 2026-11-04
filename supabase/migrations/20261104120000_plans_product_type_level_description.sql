-- More marketplace fields on plans, next to price and media
-- (20261103120000_plans_price_media). All three are optional in the database,
-- so existing plans stay valid; `POST /api/v1/coach/plans` requires product
-- type and selected level (and price) on every new plan.
--
-- product_type: what the listing sells, 'plan' or 'program'.
-- selected_level: the level the plan is for, as the frontend sends it. A plain
-- string, not a list, so the levels can change without a migration.
-- description: the listing's optional blurb.
--
-- All three ride on the existing table grants and RLS policies on plans.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS selected_level text,
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_product_type_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_product_type_check CHECK (product_type IN ('plan', 'program'));

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_selected_level_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_selected_level_check CHECK (char_length(selected_level) BETWEEN 1 AND 160);

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_description_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_description_check CHECK (char_length(description) <= 4000);

COMMENT ON COLUMN public.plans.product_type IS
  'Marketplace product type: plan or program. Required by POST /api/v1/coach/plans; NULL on older plans.';
COMMENT ON COLUMN public.plans.selected_level IS
  'The level the plan is for, as the frontend sends it. Required by POST /api/v1/coach/plans; NULL on older plans.';
COMMENT ON COLUMN public.plans.description IS
  'Optional marketplace description of the plan.';
