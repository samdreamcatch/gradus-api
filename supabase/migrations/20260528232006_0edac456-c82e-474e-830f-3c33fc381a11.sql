
-- Add 'draft' to plan status and relax the athlete requirement for drafts.
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_status_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'benched'::text, 'draft'::text]));

-- Allow drafts to exist without an athlete; only require athlete when the plan
-- is actually active or benched (i.e. promoted out of draft).
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_kind_athlete_chk;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_kind_athlete_chk
  CHECK (
    (kind = 'template' AND athlete_id IS NULL)
    OR (kind = 'plan' AND status = 'draft')
    OR (kind = 'plan' AND status IN ('active','benched') AND athlete_id IS NOT NULL)
  );

-- Existing rows that were stored as 'benched' on creation can stay; we'll
-- create new plans as 'draft' going forward.
