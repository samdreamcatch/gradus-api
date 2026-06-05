CREATE TABLE public.parent_saved_answers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sport TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parent_saved_answers TO authenticated;
GRANT ALL ON public.parent_saved_answers TO service_role;

ALTER TABLE public.parent_saved_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parents manage their saved answers"
  ON public.parent_saved_answers FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX parent_saved_answers_user_sport_idx
  ON public.parent_saved_answers (user_id, sport, created_at DESC);