ALTER TABLE public.user_reports
  ADD COLUMN IF NOT EXISTS resource_id uuid NULL REFERENCES public.resources(id) ON DELETE SET NULL;

ALTER TABLE public.user_reports
  ALTER COLUMN reported_user_id DROP NOT NULL;

ALTER TABLE public.user_reports
  ADD CONSTRAINT user_reports_target_present
  CHECK (reported_user_id IS NOT NULL OR resource_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS user_reports_resource_idx ON public.user_reports(resource_id);