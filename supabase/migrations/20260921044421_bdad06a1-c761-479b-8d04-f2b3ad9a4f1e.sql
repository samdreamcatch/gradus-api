-- lovable-cron-fallback-reviewed: knowledge ingest queue drain; per-minute cadence required so uploads become searchable promptly.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  publisher text NOT NULL DEFAULT '',
  edition text NOT NULL DEFAULT '',
  sport text NOT NULL DEFAULT 'all',
  coach_id uuid REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  resource_id uuid REFERENCES public.resources(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pdf', 'text')),
  storage_path text,
  external_url text,
  inline_text text,
  chunker text NOT NULL DEFAULT 'prose' CHECK (chunker IN ('prose', 'rules')),
  rights_basis text NOT NULL CHECK (char_length(rights_basis) > 0),
  quote_allowed boolean NOT NULL DEFAULT false,
  embedding_model text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'extracting', 'chunking', 'embedding', 'ready', 'failed')),
  page_count integer,
  chunk_count integer NOT NULL DEFAULT 0,
  error text,
  ingested_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'pdf' OR storage_path IS NOT NULL),
  CHECK (kind <> 'text' OR inline_text IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_sources_resource_idx
  ON public.knowledge_sources (resource_id) WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS knowledge_sources_coach_idx ON public.knowledge_sources (coach_id);
CREATE INDEX IF NOT EXISTS knowledge_sources_status_idx ON public.knowledge_sources (status, updated_at);

DROP TRIGGER IF EXISTS knowledge_sources_updated_at ON public.knowledge_sources;
CREATE TRIGGER knowledge_sources_updated_at
  BEFORE UPDATE ON public.knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.knowledge_pages (
  source_id uuid NOT NULL REFERENCES public.knowledge_sources(id) ON DELETE CASCADE,
  page integer NOT NULL CHECK (page >= 1),
  text text NOT NULL,
  PRIMARY KEY (source_id, page)
);

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.knowledge_sources(id) ON DELETE CASCADE,
  coach_id uuid,
  sport text NOT NULL DEFAULT 'all',
  ordinal integer NOT NULL,
  page integer,
  section text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  content_hash text NOT NULL,
  token_estimate integer NOT NULL DEFAULT 0,
  embedding extensions.vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, ordinal)
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_scope_idx ON public.knowledge_chunks (sport, coach_id);
CREATE INDEX IF NOT EXISTS knowledge_chunks_pending_idx
  ON public.knowledge_chunks (source_id) WHERE embedding IS NULL;
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON public.knowledge_chunks USING hnsw (embedding extensions.vector_cosine_ops);

GRANT ALL ON public.knowledge_sources TO service_role;
GRANT ALL ON public.knowledge_pages TO service_role;
GRANT ALL ON public.knowledge_chunks TO service_role;

ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding extensions.vector(1536),
  p_sport text,
  p_coach_ids uuid[],
  p_limit integer
)
RETURNS TABLE (
  chunk_id uuid,
  source_id uuid,
  title text,
  publisher text,
  edition text,
  section text,
  page integer,
  content text,
  quote_allowed boolean,
  resource_id uuid,
  external_url text,
  similarity double precision
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    s.id,
    s.title,
    s.publisher,
    s.edition,
    c.section,
    c.page,
    c.content,
    s.quote_allowed,
    s.resource_id,
    s.external_url,
    1 - (c.embedding <=> query_embedding)
  FROM public.knowledge_chunks c
  JOIN public.knowledge_sources s ON s.id = c.source_id
  WHERE c.embedding IS NOT NULL
    AND s.status = 'ready'
    AND (c.sport = 'all' OR c.sport = p_sport)
    AND (c.coach_id IS NULL OR c.coach_id = ANY (COALESCE(p_coach_ids, ARRAY[]::uuid[])))
  ORDER BY c.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(p_limit, 50));
$$;

REVOKE ALL ON FUNCTION public.match_knowledge_chunks(extensions.vector, text, uuid[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, text, uuid[], integer)
  TO service_role;

DO $$ BEGIN
  PERFORM cron.unschedule('knowledge-ingest-every-minute');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'knowledge-ingest-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/knowledge-ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);