/**
 * Knowledge ingestion (PRD §6.7 "Grounded Ask Gradus", milestone L4).
 *
 * A source moves through `queued → extracting → chunking → embedding →
 * ready` (or `failed`), one stage step per `ingestStep` call, and every
 * step is resumable from the database alone:
 *
 *   extracting  reads the next `EXTRACT_WINDOW` pages of the PDF and
 *               checkpoints them into `knowledge_pages`; done when the
 *               page count is reached. Inline text sources skip this.
 *   chunking    chunks all pages (src/lib/knowledge-chunking.ts) and
 *               inserts `knowledge_chunks` rows without embeddings.
 *   embedding   embeds the next `EMBED_BATCH` chunks whose embedding is
 *               NULL; when none remain the source is finalized.
 *   finalize    a cite-only source (quote_allowed = false) has its chunk
 *               text and page text scrubbed here, so once it is `ready`
 *               the database holds embeddings, sections and pages only.
 *
 * Why the loop lives in the Worker: no session holds a service-role key
 * (PRD §4.1 rule 10), so there is no local script. The admin page drives a
 * source to completion when it is registered or "Run ingestion now" is
 * pressed (it keeps calling until the queue is empty); pg_cron calls
 * `/api/public/hooks/knowledge-ingest` every six hours only to finish
 * anything left half-done. `runKnowledgeIngest` takes as many steps as
 * fit in its time budget.
 *
 * The admin client is typed loosely because the knowledge tables are not
 * in the generated Supabase types (same accommodation as competition
 * recaps in coach-athlete-detail.server.ts).
 */
import { chunkPages, chunkText, type Chunker } from "./knowledge-chunking";
import {
  createGatewayEmbedder,
  embeddingModelId,
  toVectorLiteral,
  type EmbedFn,
  type EmbeddingEnv,
} from "./knowledge-embeddings.server";
import type { PdfPageExtractor } from "./knowledge-pdf.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LooseAdmin = {
  from: (table: string) => any;
  storage?: { from: (bucket: string) => any };
};

export const EXTRACT_WINDOW = 40;
export const EMBED_BATCH = 32;
export const KNOWLEDGE_BUCKET = "resource-pdfs";

export type SourceStatus = "queued" | "extracting" | "chunking" | "embedding" | "ready" | "failed";

export type KnowledgeSourceRow = {
  id: string;
  title: string;
  publisher: string;
  edition: string;
  sport: string;
  coach_id: string | null;
  resource_id: string | null;
  kind: "pdf" | "text";
  storage_path: string | null;
  external_url: string | null;
  inline_text: string | null;
  chunker: Chunker;
  rights_basis: string;
  quote_allowed: boolean;
  embedding_model: string | null;
  status: SourceStatus;
  page_count: number | null;
  chunk_count: number;
  error: string | null;
  ingested_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RegisterKnowledgeSourceInput = {
  title: string;
  publisher?: string;
  edition?: string;
  sport?: string;
  coachId?: string | null;
  resourceId?: string | null;
  kind: "pdf" | "text";
  storagePath?: string | null;
  externalUrl?: string | null;
  inlineText?: string | null;
  chunker?: Chunker;
  rightsBasis: string;
  quoteAllowed: boolean;
  createdBy?: string | null;
};

function dbFail(error: { message?: string } | null | undefined, what: string): never {
  throw new Error(`${what}: ${error?.message ?? "unknown database error"}`);
}

/** Insert a source in `queued`; the cron (or an admin "run now") picks it up. */
export async function registerKnowledgeSource(
  admin: LooseAdmin,
  input: RegisterKnowledgeSourceInput,
): Promise<{ id: string }> {
  if (input.kind === "pdf" && !input.storagePath)
    throw new Error("A PDF source needs a storage path");
  if (input.kind === "text" && !input.inlineText?.trim())
    throw new Error("A text source needs text");
  if (!input.rightsBasis.trim()) throw new Error("A rights basis is required");
  const { data, error } = await admin
    .from("knowledge_sources")
    .insert({
      title: input.title.trim(),
      publisher: input.publisher?.trim() ?? "",
      edition: input.edition?.trim() ?? "",
      sport: input.sport?.trim() || "all",
      coach_id: input.coachId ?? null,
      resource_id: input.resourceId ?? null,
      kind: input.kind,
      storage_path: input.storagePath ?? null,
      external_url: input.externalUrl ?? null,
      inline_text: input.inlineText ?? null,
      chunker: input.chunker ?? "prose",
      rights_basis: input.rightsBasis.trim(),
      quote_allowed: input.quoteAllowed,
      status: "queued",
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error || !data) dbFail(error, "register knowledge source");
  return { id: data.id as string };
}

/** Drop everything derived and start over (after a chunker change, a new edition, or a failure). */
export async function requeueKnowledgeSource(admin: LooseAdmin, id: string): Promise<void> {
  const c = await admin.from("knowledge_chunks").delete().eq("source_id", id);
  if (c.error) dbFail(c.error, "clear chunks");
  const p = await admin.from("knowledge_pages").delete().eq("source_id", id);
  if (p.error) dbFail(p.error, "clear pages");
  const s = await admin
    .from("knowledge_sources")
    .update({
      status: "queued",
      error: null,
      chunk_count: 0,
      page_count: null,
      ingested_at: null,
      embedding_model: null,
    })
    .eq("id", id);
  if (s.error) dbFail(s.error, "requeue source");
}

export type IngestDeps = {
  admin: LooseAdmin;
  env?: EmbeddingEnv;
  /** Injected in tests; defaults to the gateway. Created lazily so extraction never needs the key. */
  embed?: EmbedFn;
  /** Injected in tests; defaults to pdf.js through unpdf. */
  extract?: PdfPageExtractor;
  now?: () => Date;
};

export type StepResult = {
  sourceId: string;
  from: SourceStatus;
  to: SourceStatus;
  detail: string;
};

async function pickSource(admin: LooseAdmin): Promise<KnowledgeSourceRow | null> {
  const { data, error } = await admin
    .from("knowledge_sources")
    .select("*")
    .in("status", ["queued", "extracting", "chunking", "embedding"])
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) dbFail(error, "pick source");
  return (data as KnowledgeSourceRow | null) ?? null;
}

async function setStatus(
  admin: LooseAdmin,
  id: string,
  patch: Partial<KnowledgeSourceRow>,
): Promise<void> {
  const { error } = await admin.from("knowledge_sources").update(patch).eq("id", id);
  if (error) dbFail(error, "update source");
}

async function loadExtractor(deps: IngestDeps): Promise<PdfPageExtractor> {
  if (deps.extract) return deps.extract;
  const mod = await import("./knowledge-pdf.server");
  return mod.extractPdfPages;
}

async function downloadPdf(admin: LooseAdmin, path: string): Promise<Uint8Array> {
  if (!admin.storage) throw new Error("storage client unavailable");
  const { data, error } = await admin.storage.from(KNOWLEDGE_BUCKET).download(path);
  if (error || !data) throw new Error(`download ${path}: ${error?.message ?? "no data"}`);
  const buf = await (data as Blob).arrayBuffer();
  return new Uint8Array(buf);
}

async function stepQueued(deps: IngestDeps, s: KnowledgeSourceRow): Promise<StepResult> {
  const { admin } = deps;
  if (s.kind === "text") {
    const { error } = await admin
      .from("knowledge_pages")
      .upsert(
        { source_id: s.id, page: 1, text: s.inline_text ?? "" },
        { onConflict: "source_id,page" },
      );
    if (error) dbFail(error, "store inline text");
    await setStatus(admin, s.id, { status: "chunking", page_count: 1, error: null });
    return { sourceId: s.id, from: "queued", to: "chunking", detail: "inline text stored" };
  }
  await setStatus(admin, s.id, { status: "extracting", error: null });
  return { sourceId: s.id, from: "queued", to: "extracting", detail: "started" };
}

async function stepExtracting(deps: IngestDeps, s: KnowledgeSourceRow): Promise<StepResult> {
  const { admin } = deps;
  const { count, error: cErr } = await admin
    .from("knowledge_pages")
    .select("page", { count: "exact", head: true })
    .eq("source_id", s.id);
  if (cErr) dbFail(cErr, "count pages");
  const done = (count as number | null) ?? 0;
  const bytes = await downloadPdf(admin, s.storage_path!);
  const extract = await loadExtractor(deps);
  const { pageCount, pages } = await extract(bytes, done + 1, done + 1 + EXTRACT_WINDOW);
  if (pages.length) {
    const { error } = await admin.from("knowledge_pages").upsert(
      pages.map((p) => ({ source_id: s.id, page: p.page, text: p.text })),
      { onConflict: "source_id,page" },
    );
    if (error) dbFail(error, "store pages");
  }
  const reached = done + pages.length;
  if (reached >= pageCount || pages.length === 0) {
    await setStatus(admin, s.id, { status: "chunking", page_count: pageCount });
    return {
      sourceId: s.id,
      from: "extracting",
      to: "chunking",
      detail: `${reached}/${pageCount} pages`,
    };
  }
  // Touch updated_at so round-robin ordering moves on if several sources are queued.
  await setStatus(admin, s.id, { status: "extracting" });
  return {
    sourceId: s.id,
    from: "extracting",
    to: "extracting",
    detail: `${reached}/${pageCount} pages`,
  };
}

async function stepChunking(deps: IngestDeps, s: KnowledgeSourceRow): Promise<StepResult> {
  const { admin } = deps;
  const { data, error } = await admin
    .from("knowledge_pages")
    .select("page, text")
    .eq("source_id", s.id)
    .order("page", { ascending: true });
  if (error) dbFail(error, "load pages");
  const pages = (data ?? []) as Array<{ page: number; text: string }>;
  const chunks =
    s.kind === "text"
      ? chunkText(pages.map((p) => p.text).join("\n\n"), s.chunker)
      : chunkPages(pages, s.chunker);

  const del = await admin.from("knowledge_chunks").delete().eq("source_id", s.id);
  if (del.error) dbFail(del.error, "clear chunks");

  for (let i = 0; i < chunks.length; i += 100) {
    const rows = chunks.slice(i, i + 100).map((c) => ({
      source_id: s.id,
      coach_id: s.coach_id,
      sport: s.sport,
      ordinal: c.ordinal,
      page: c.page,
      section: c.section,
      content: c.content,
      content_hash: c.contentHash,
      token_estimate: c.tokenEstimate,
    }));
    const ins = await admin.from("knowledge_chunks").insert(rows);
    if (ins.error) dbFail(ins.error, "insert chunks");
  }
  await setStatus(admin, s.id, { status: "embedding", chunk_count: chunks.length });
  return { sourceId: s.id, from: "chunking", to: "embedding", detail: `${chunks.length} chunks` };
}

async function finalize(deps: IngestDeps, s: KnowledgeSourceRow): Promise<StepResult> {
  const { admin } = deps;
  if (!s.quote_allowed) {
    const scrub = await admin
      .from("knowledge_chunks")
      .update({ content: "" })
      .eq("source_id", s.id);
    if (scrub.error) dbFail(scrub.error, "scrub cite-only chunks");
    const pages = await admin.from("knowledge_pages").delete().eq("source_id", s.id);
    if (pages.error) dbFail(pages.error, "scrub cite-only pages");
  }
  await setStatus(admin, s.id, {
    status: "ready",
    error: null,
    embedding_model: embeddingModelId(deps.env ?? process.env),
    ingested_at: (deps.now?.() ?? new Date()).toISOString(),
  });
  return {
    sourceId: s.id,
    from: "embedding",
    to: "ready",
    detail: s.quote_allowed ? "ready" : "ready (cite-only, text scrubbed)",
  };
}

async function stepEmbedding(deps: IngestDeps, s: KnowledgeSourceRow): Promise<StepResult> {
  const { admin } = deps;
  const { data, error } = await admin
    .from("knowledge_chunks")
    .select("id, content")
    .eq("source_id", s.id)
    .is("embedding", null)
    .order("ordinal", { ascending: true })
    .limit(EMBED_BATCH);
  if (error) dbFail(error, "load pending chunks");
  const pending = (data ?? []) as Array<{ id: string; content: string }>;
  if (!pending.length) return finalize(deps, s);

  const embed = deps.embed ?? createGatewayEmbedder(deps.env ?? process.env);
  const vectors = await embed(pending.map((c) => c.content));
  for (let i = 0; i < pending.length; i++) {
    const { error: uErr } = await admin
      .from("knowledge_chunks")
      .update({ embedding: toVectorLiteral(vectors[i]!) })
      .eq("id", pending[i]!.id);
    if (uErr) dbFail(uErr, "store embedding");
  }
  await setStatus(admin, s.id, { status: "embedding" });
  return {
    sourceId: s.id,
    from: "embedding",
    to: "embedding",
    detail: `${pending.length} embedded`,
  };
}

/** Advance the oldest in-progress source by one stage step. `null` when nothing is queued. */
export async function ingestStep(deps: IngestDeps): Promise<StepResult | null> {
  const s = await pickSource(deps.admin);
  if (!s) return null;
  try {
    switch (s.status) {
      case "queued":
        return await stepQueued(deps, s);
      case "extracting":
        return await stepExtracting(deps, s);
      case "chunking":
        return await stepChunking(deps, s);
      case "embedding":
        return await stepEmbedding(deps, s);
      default:
        return null;
    }
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    console.error("[knowledge-ingest] source failed", s.id, message);
    await setStatus(deps.admin, s.id, { status: "failed", error: message });
    return { sourceId: s.id, from: s.status, to: "failed", detail: message };
  }
}

export type IngestReport = { steps: StepResult[]; idle: boolean; elapsedMs: number };

/** Take steps until the queue is empty or the time budget is spent. */
export async function runKnowledgeIngest(
  deps: IngestDeps,
  opts: { maxMs?: number; maxSteps?: number } = {},
): Promise<IngestReport> {
  const maxMs = opts.maxMs ?? 20_000;
  const maxSteps = opts.maxSteps ?? 50;
  const start = Date.now();
  const steps: StepResult[] = [];
  let idle = false;
  while (steps.length < maxSteps && Date.now() - start < maxMs) {
    const r = await ingestStep(deps);
    if (!r) {
      idle = true;
      break;
    }
    steps.push(r);
    if (r.to === "failed") break; // let the next tick move on to the next source
  }
  return { steps, idle, elapsedMs: Date.now() - start };
}
