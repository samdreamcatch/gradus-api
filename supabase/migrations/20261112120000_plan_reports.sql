-- Plan reports (src/lib/plan-reports.server.ts): "Report this plan" on a
-- marketplace plan. The reporter picks what's wrong (inappropriate content,
-- a misleading listing, or an unsafe instruction) and may add a note; the
-- safety inbox is emailed and an admin reviews it, like a user report
-- (`user_reports`).
--
-- The record outlives what it's about: the plan or its coach may be deleted
-- later (SET NULL; `plan_title` keeps what was reported), and the reporter
-- has no foreign key, as on `user_reports` and `message_flags`.
--
-- One open report per person per plan: reporting again while the first is
-- open changes nothing. After an admin closes it, they may report again.
--
-- Server-only: RLS on, no policies and no grants to `authenticated`. The API
-- and the admin functions use the service role.
--
-- Additive and safe for the live app: one new table, nothing else changes.
CREATE TABLE IF NOT EXISTS public.plan_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES public.plans (id) ON DELETE SET NULL,
  plan_title text NOT NULL DEFAULT '',
  coach_id uuid REFERENCES public.coach_profiles (id) ON DELETE SET NULL,
  reporter_user_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('inappropriate', 'misleading', 'unsafe')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'actioned', 'dismissed')),
  admin_notes text NOT NULL DEFAULT '' CHECK (char_length(admin_notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS plan_reports_one_open_per_reporter
  ON public.plan_reports (plan_id, reporter_user_id)
  WHERE status = 'open';
-- The admin list, newest first, open ones on their own.
CREATE INDEX IF NOT EXISTS plan_reports_status_created_idx
  ON public.plan_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS plan_reports_plan_idx ON public.plan_reports (plan_id);

ALTER TABLE public.plan_reports ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.plan_reports TO service_role;

DROP TRIGGER IF EXISTS update_plan_reports_updated_at ON public.plan_reports;
CREATE TRIGGER update_plan_reports_updated_at
  BEFORE UPDATE ON public.plan_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.plan_reports IS
  'Reports of marketplace plans (inappropriate, misleading, unsafe), reviewed by admins. Server-only.';
COMMENT ON COLUMN public.plan_reports.plan_title IS
  'The plan''s title when reported; kept if the plan is deleted.';
