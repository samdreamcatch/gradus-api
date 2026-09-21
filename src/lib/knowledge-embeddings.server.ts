/**
 * Embeddings for the knowledge corpus (PRD §6.7 "Grounded Ask Gradus").
 *
 * Goes through the same Lovable AI Gateway every other AI call uses, so no
 * new vendor or key. The model is an environment setting because the
 * gateway's embedding model identifiers are not published in Lovable's
 * docs; the first preview run confirms the default below. Whatever the
 * model, vectors must be exactly `EMBEDDING_DIMENSIONS` wide (the column
 * type is `vector(1536)`), so a wrong model fails loudly here instead of
 * at insert time. Changing the model means re-ingesting every source;
 * `knowledge_sources.embedding_model` records which model produced each
 * source's vectors so a mixed corpus is detectable (PRD §11 risk 20).
 */
import { embedMany } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

export const EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export type EmbeddingEnv = {
  LOVABLE_API_KEY?: string;
  KNOWLEDGE_EMBEDDING_MODEL?: string;
};

export function embeddingModelId(env: EmbeddingEnv = process.env): string {
  return env.KNOWLEDGE_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

export class EmbeddingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingUnavailableError";
  }
}

/** Reject any vector that is not the column width; the caller marks the source failed. */
export function assertDimensions(vectors: number[][], model: string): void {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingUnavailableError(
        `Embedding model "${model}" returned ${v.length} dimensions; the corpus stores ${EMBEDDING_DIMENSIONS}. ` +
          `Set KNOWLEDGE_EMBEDDING_MODEL to a ${EMBEDDING_DIMENSIONS}-dimension model and re-ingest.`,
      );
    }
  }
}

/** Real gateway call. Batches are the caller's concern (32 at a time in ingestion). */
export function createGatewayEmbedder(env: EmbeddingEnv = process.env): EmbedFn {
  const key = env.LOVABLE_API_KEY;
  if (!key) {
    throw new EmbeddingUnavailableError("LOVABLE_API_KEY not set");
  }
  const model = embeddingModelId(env);
  const gateway = createLovableAiGatewayProvider(key);
  return async (texts) => {
    if (!texts.length) return [];
    const { embeddings } = await embedMany({
      model: gateway.embeddingModel(model),
      values: texts,
    });
    assertDimensions(embeddings, model);
    return embeddings;
  };
}

/** pgvector accepts the JSON array literal for a `vector` parameter. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
