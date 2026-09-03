ALTER TABLE public.competition_attendance
  ADD COLUMN IF NOT EXISTS viewer_role text NOT NULL DEFAULT 'parent';

UPDATE public.competition_attendance ca
SET viewer_role = 'athlete'
WHERE EXISTS (SELECT 1 FROM public.athletes a WHERE a.user_id = ca.user_id);

UPDATE public.competition_attendance ca
SET viewer_role = 'coach'
WHERE EXISTS (SELECT 1 FROM public.coach_profiles c WHERE c.user_id = ca.user_id);

CREATE INDEX IF NOT EXISTS competition_attendance_role_idx
  ON public.competition_attendance (viewer_role, user_id);