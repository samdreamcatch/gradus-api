/**
 * Retrieval over the knowledge corpus (PRD §6.7 "Grounded Ask Gradus").
 *
 * L4 ships the read path so the corpus can be checked from the admin panel
 * (search and the known-answer set); L5 wires `askGradus` to it. The
 * prompt block keeps the existing untrusted-content wrapping: a rulebook
 * passage is data, never an instruction. Cite-only sources (no stored
 * text) appear as a pointer to title, section and page.
 */
import { sanitizeUserContent, wrapUntrusted } from "./ai-prompt-safety";
import { toVectorLiteral, type EmbedFn } from "./knowledge-embeddings.server";
import type { LooseAdmin } from "./knowledge-ingest.server";

export type KnowledgeHit = {
  chunkId: string;
  sourceId: string;
  title: string;
  publisher: string;
  edition: string;
  section: string;
  page: number | null;
  /** '' for a cite-only source. */
  content: string;
  quoteAllowed: boolean;
  resourceId: string | null;
  externalUrl: string | null;
  similarity: number;
};

export type RetrieveInput = {
  admin: LooseAdmin & {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
  embed: EmbedFn;
  question: string;
  sport: string;
  coachIds?: string[];
  limit?: number;
};

export async function retrieveKnowledge(input: RetrieveInput): Promise<KnowledgeHit[]> {
  const [vector] = await input.embed([input.question.trim().slice(0, 4000)]);
  if (!vector) return [];
  const { data, error } = await input.admin.rpc("match_knowledge_chunks", {
    query_embedding: toVectorLiteral(vector),
    p_sport: input.sport,
    p_coach_ids: input.coachIds ?? [],
    p_limit: input.limit ?? 8,
  });
  if (error) throw new Error(`knowledge retrieval: ${error.message ?? "unknown error"}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (Array.isArray(data) ? data : []) as any[];
  return rows.map((r) => ({
    chunkId: r.chunk_id as string,
    sourceId: r.source_id as string,
    title: r.title as string,
    publisher: (r.publisher as string) ?? "",
    edition: (r.edition as string) ?? "",
    section: (r.section as string) ?? "",
    page: (r.page as number | null) ?? null,
    content: (r.content as string) ?? "",
    quoteAllowed: !!r.quote_allowed,
    resourceId: (r.resource_id as string | null) ?? null,
    externalUrl: (r.external_url as string | null) ?? null,
    similarity: Number(r.similarity ?? 0),
  }));
}

export type Citation = {
  index: number;
  title: string;
  publisher: string;
  edition: string;
  section: string;
  page: number | null;
  resourceId: string | null;
  externalUrl: string | null;
};

export function describeHit(h: KnowledgeHit): string {
  const where = [h.section, h.page ? `p. ${h.page}` : ""].filter(Boolean).join(", ");
  const ed = h.edition ? ` (${h.edition})` : "";
  return `${h.title}${ed}${where ? ` — ${where}` : ""}`;
}

/**
 * The passages block for a prompt, numbered so the model can cite `[n]`,
 * plus the citation list the answer returns. Passage text is wrapped as
 * untrusted content and capped per passage.
 */
export function formatKnowledgeForPrompt(
  hits: KnowledgeHit[],
  opts: { maxCharsPerPassage?: number } = {},
): { block: string; citations: Citation[] } {
  const cap = opts.maxCharsPerPassage ?? 1600;
  const citations: Citation[] = [];
  const lines: string[] = [];
  hits.forEach((h, i) => {
    const index = i + 1;
    citations.push({
      index,
      title: h.title,
      publisher: h.publisher,
      edition: h.edition,
      section: h.section,
      page: h.page,
      resourceId: h.resourceId,
      externalUrl: h.externalUrl,
    });
    if (h.quoteAllowed && h.content) {
      lines.push(
        `[${index}] ${describeHit(h)}\n${wrapUntrusted(`source_${index}`, sanitizeUserContent(h.content, cap))}`,
      );
    } else {
      lines.push(
        `[${index}] ${describeHit(h)}\n(This source may be cited but not quoted: point the reader to it rather than reproducing its text.)`,
      );
    }
  });
  return { block: lines.join("\n\n"), citations };
}
