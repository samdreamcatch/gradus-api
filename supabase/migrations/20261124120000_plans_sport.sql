-- The sport a plan is for, so the marketplace's sport chips (Figure Skating,
-- Dance, Gymnastics, ...) can filter by it. Level keys can't stand in for it:
-- many are shared across sports ("beginner", "10u", "u14", ...).
--
-- A plain text column holding a sport key from the app's sport catalog
-- (src/lib/coach-sports.ts; the iOS app's SportCatalog), e.g. "figure_skating".
-- The coach picks it in the plan editor; the server only checks its shape, so
-- a sport added to the catalog needs no migration.
--
-- Rides on the existing grants and RLS policies on plans (the owning coach
-- writes it, the readers that can see a plan can see it).
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS sport text;

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_sport_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_sport_check CHECK (sport IS NULL OR sport ~ '^[a-z0-9_]{1,64}$');

-- Every plan made before this was a figure-skating plan.
UPDATE public.plans SET sport = 'figure_skating' WHERE sport IS NULL;

-- The marketplace lists active plans, filtered by sport.
CREATE INDEX IF NOT EXISTS plans_active_sport_idx
  ON public.plans (sport)
  WHERE status = 'active';

COMMENT ON COLUMN public.plans.sport IS
  'The sport key the plan is for (the app''s sport catalog, e.g. figure_skating); filters the marketplace. Null only on plans saved without one.';
