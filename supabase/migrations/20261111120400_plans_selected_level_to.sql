-- A plan's level can be a range (src/lib/plan-marketplace-fields.server.ts):
-- selected_level holds the single level, or the first of a range; the new
-- selected_level_to holds the range's other end. NULL means a single level.
-- Both are sport level keys (src/lib/coach-sports.ts), e.g. 'basic_skills'
-- to 'pre_juvenile'.
--
-- The column rides on the existing table grants and RLS policies on plans.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS selected_level_to text;

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_selected_level_to_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_selected_level_to_check CHECK (
    selected_level_to IS NULL
    OR (char_length(selected_level_to) BETWEEN 1 AND 160 AND selected_level IS NOT NULL)
  );

COMMENT ON COLUMN public.plans.selected_level_to IS
  'The other end of a level range (a sport level key); NULL for a single level in selected_level. Needs selected_level.';
