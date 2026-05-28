
-- #4: athlete_goals — require coach_id to be linked to athlete via coach_athletes
DROP POLICY IF EXISTS "Parents manage goals for own athletes - insert" ON public.athlete_goals;
DROP POLICY IF EXISTS "Parents manage goals for own athletes - update" ON public.athlete_goals;

CREATE POLICY "Parents manage goals for own athletes - insert"
ON public.athlete_goals
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM athletes a
    JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = athlete_goals.athlete_id AND pp.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM coach_athletes ca
    WHERE ca.athlete_id = athlete_goals.athlete_id
      AND ca.coach_id = athlete_goals.coach_id
  )
);

CREATE POLICY "Parents manage goals for own athletes - update"
ON public.athlete_goals
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM athletes a
    JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = athlete_goals.athlete_id AND pp.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM athletes a
    JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = athlete_goals.athlete_id AND pp.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM coach_athletes ca
    WHERE ca.athlete_id = athlete_goals.athlete_id
      AND ca.coach_id = athlete_goals.coach_id
  )
);

-- #5: athlete_lesson_slots — same constraint
DROP POLICY IF EXISTS "Parents manage slots for own athletes - insert" ON public.athlete_lesson_slots;
DROP POLICY IF EXISTS "Parents manage slots for own athletes - update" ON public.athlete_lesson_slots;

CREATE POLICY "Parents manage slots for own athletes - insert"
ON public.athlete_lesson_slots
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM athletes a
    JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = athlete_lesson_slots.athlete_id AND pp.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM coach_athletes ca
    WHERE ca.athlete_id = athlete_lesson_slots.athlete_id
      AND ca.coach_id = athlete_lesson_slots.coach_id
  )
);

CREATE POLICY "Parents manage slots for own athletes - update"
ON public.athlete_lesson_slots
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM athletes a
    JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = athlete_lesson_slots.athlete_id AND pp.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM athletes a
    JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = athlete_lesson_slots.athlete_id AND pp.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM coach_athletes ca
    WHERE ca.athlete_id = athlete_lesson_slots.athlete_id
      AND ca.coach_id = athlete_lesson_slots.coach_id
  )
);

-- #7: rate-limit log for anonymous invite-code lookups
CREATE TABLE public.invite_lookup_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip text NOT NULL,
  code text,
  found boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invite_lookup_attempts_ip_time
  ON public.invite_lookup_attempts (ip, attempted_at DESC);

GRANT ALL ON public.invite_lookup_attempts TO service_role;

ALTER TABLE public.invite_lookup_attempts ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (server functions) may read/write.
