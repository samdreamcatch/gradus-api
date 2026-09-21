-- Knowledge corpus for grounded Ask Gradus (PRD §6.7 "Grounded Ask Gradus",
-- milestone L4 in §10.7).
--
-- Three service-role-only tables and one retrieval function:
--
--   knowledge_sources  one row per document Gradus may answer from. Every row
--                      carries a `rights_basis` (why Gradus may store and
--                      cite it) and `quote_allowed` (whether passages may be
--                      reproduced inside an answer). A source with
--                      quote_allowed = false is "cite-only": after ingestion
--                      its chunk text and page text are scrubbed, and only
--                      the embedding, section and page remain, so an answer
--                      can point to the document but never quote it.
--   knowledge_pages    extracted page text, the resumable checkpoint of a
--                      long PDF extraction. Scrubbed for cite-only sources.
--   knowledge_chunks   the retrieval unit: text (or '' when cite-only), the
--                      section heading it sits under, its page, and a
--                      1536-dimension embedding (pgvector, cosine, HNSW).
--
-- Ingestion runs inside the Worker (no session holds a service-role key,
-- PRD §4.1 rule 10): `POST /api/public/hooks/knowledge-ingest` is called by
-- pg_cron every minute and advances one source one stage per call
-- (src/lib/knowledge-ingest.server.ts). Nothing here is reachable from the
-- publishable key: RLS is enabled with no policies, and the retrieval
-- function is EXECUTE-able by the service role only (§4.1 rule 12).

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  publisher text NOT NULL DEFAULT '',
  edition text NOT NULL DEFAULT '',
  -- 'all' or a sport key from src/lib/coach-sports.ts. Coach-scoped sources
  -- use 'all' and are filtered by coach_id instead.
  sport text NOT NULL DEFAULT 'all',
  -- Set for a coach's own uploaded resource: retrievable only for that
  -- coach's athletes and their guardians. NULL = global corpus.
  coach_id uuid REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  -- Set when the document is a library resource, so deleting the resource
  -- removes its chunks too.
  resource_id uuid REFERENCES public.resources(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pdf', 'text')),
  storage_path text,
  external_url text,
  inline_text text,
  chunker text NOT NULL DEFAULT 'prose' CHECK (chunker IN ('prose', 'rules')),
  -- Free text, required: e.g. 'coach_upload', 'gradus_owned',
  -- 'public_domain_us_gov', 'written permission 2026-10-02 (email from …)',
  -- 'pending permission: cite-only'. docs/knowledge/SOURCES.md is the ledger.
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
  -- Denormalized from the source so retrieval filters without a join.
  coach_id uuid,
  sport text NOT NULL DEFAULT 'all',
  ordinal integer NOT NULL,
  page integer,
  section text NOT NULL DEFAULT '',
  -- '' once a cite-only source is ready (see header).
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
-- No policies on purpose: the server reads and writes through the admin
-- client only (admin panel and the ingest hook). Ask Gradus retrieval (L5)
-- also runs server-side.

-- Retrieval: nearest chunks for a question, limited to the asker's sport
-- (plus sport-agnostic sources) and to the global corpus plus the corpora of
-- the coaches passed in. Returns everything the prompt and the citation need.
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

-- Service-role only (§4.1 rule 12): the default privileges would otherwise
-- let anyone with the publishable key run similarity search over the corpus.
REVOKE ALL ON FUNCTION public.match_knowledge_chunks(extensions.vector, text, uuid[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, text, uuid[], integer)
  TO service_role;

-- Drain the ingest queue every minute. The hook returns immediately when
-- nothing is queued. Authenticates like the re-keyed hook crons
-- (20260921003705): the service role key read from the vault at call time,
-- never the public anon key.
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
