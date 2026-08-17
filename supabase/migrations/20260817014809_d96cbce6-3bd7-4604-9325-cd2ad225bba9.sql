ALTER TABLE public.lifecycle_email_jobs ADD COLUMN IF NOT EXISTS message_id text;

ALTER TABLE public.lifecycle_email_jobs DROP CONSTRAINT IF EXISTS lifecycle_email_jobs_status_check;
ALTER TABLE public.lifecycle_email_jobs ADD CONSTRAINT lifecycle_email_jobs_status_check CHECK (status IN ('pending','queued','sent','skipped','failed'));

CREATE INDEX IF NOT EXISTS lifecycle_email_jobs_message_id_idx ON public.lifecycle_email_jobs (message_id) WHERE message_id IS NOT NULL;