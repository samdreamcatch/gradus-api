-- How long a plan runs, for its marketplace preview
-- (src/lib/plan-marketplace-fields.server.ts): weeks it runs, practice
-- sessions per week, and, for a Program, how many lessons it has. All three
-- are optional: NULL on older plans, and the preview leaves out what's unset.
--
-- The columns ride on the existing table grants and RLS policies on plans.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS weeks integer,
  ADD COLUMN IF NOT EXISTS sessions_per_week integer,
  ADD COLUMN IF NOT EXISTS lesson_count integer;

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_weeks_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_weeks_check CHECK (weeks IS NULL OR weeks BETWEEN 1 AND 52);

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_sessions_per_week_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_sessions_per_week_check CHECK (
    sessions_per_week IS NULL OR sessions_per_week BETWEEN 1 AND 14
  );

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_lesson_count_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_lesson_count_check CHECK (
    lesson_count IS NULL OR lesson_count BETWEEN 1 AND 100
  );

COMMENT ON COLUMN public.plans.weeks IS
  'How many weeks the plan runs (1-52); NULL when the coach didn''t say.';
COMMENT ON COLUMN public.plans.sessions_per_week IS
  'Practice sessions per week (1-14); NULL when the coach didn''t say.';
COMMENT ON COLUMN public.plans.lesson_count IS
  'Lessons in a Program (product_type = ''program''), 1-100; NULL for a Plan or when unset.';
