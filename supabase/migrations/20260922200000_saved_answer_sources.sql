-- Saved Ask Gradus answers keep their sources (PRD §6.7 "Grounded Ask
-- Gradus" item 6, milestone L5): the cited sources, whether the answer was
-- grounded, and whether it was a safety answer (so the saved copy shows the
-- Safe Sport panel too). Additive, with defaults, so every existing row reads
-- as before: no sources, not flagged. The web does not send these yet.
ALTER TABLE public.parent_saved_answers
  ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS grounded boolean,
  ADD COLUMN IF NOT EXISTS safety boolean NOT NULL DEFAULT false;
