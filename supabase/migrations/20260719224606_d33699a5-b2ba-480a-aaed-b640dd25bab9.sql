ALTER TABLE public.lesson_wrap_ups DROP CONSTRAINT IF EXISTS lesson_wrap_ups_action_check;
ALTER TABLE public.lesson_wrap_ups ADD CONSTRAINT lesson_wrap_ups_action_check
  CHECK (action IN ('edited', 'redeployed', 'dismissed', 'did_not_happen'));