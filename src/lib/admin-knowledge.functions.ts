/**
 * Admin panel server functions for the knowledge corpus (PRD §6.7 "Grounded
 * Ask Gradus", L4). Internal admins only (`has_role(admin)`), like the rest
 * of admin.functions.ts. Everything touches the knowledge tables through
 * the service-role client because they have no RLS policies by design.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { SPORT_KEYS } from "./coach-sports";
import { createGatewayEmbedder } from "./knowledge-embeddings.server";
import {
  KNOWLEDGE_BUCKET,
  registerKnowledgeSource,
  requeueKnowledgeSource,
  runKnowledgeIngest,
  type KnowledgeSourceRow,
} from "./knowledge-ingest.server";
import { KNOWN_ANSWER_CASES } from "./knowledge-known-answers";
import { retrieveKnowledge, type KnowledgeHit } from "./knowledge-retrieval.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function assertAdmin(context: { userId: string; supabase: AnyClient }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
  return context.userId;
}

async function adminClient(): Promise<AnyClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as AnyClient;
}

const sportSchema = z.enum(["all", ...SPORT_KEYS] as [string, ...string[]]);
const chunkerSchema = z.enum(["prose", "rules"]);
const rightsSchema = z.string().trim().min(3).max(400);

const registerCommon = {
  publisher: z.string().trim().max(160).default(""),
  edition: z.string().trim().max(80).default(""),
  sport: sportSchema.default("all"),
  chunker: chunkerSchema.default("prose"),
  rightsBasis: rightsSchema,
  quoteAllowed: z.boolean().default(false),
};

export type KnowledgeSourceDTO = {
  id: string;
  title: string;
  publisher: string;
  edition: string;
  sport: string;
  coachId: string | null;
  resourceId: string | null;
  kind: "pdf" | "text";
  storagePath: string | null;
  externalUrl: string | null;
  chunker: "prose" | "rules";
  rightsBasis: string;
  quoteAllowed: boolean;
  embeddingModel: string | null;
  status: KnowledgeSourceRow["status"];
  pageCount: number | null;
  chunkCount: number;
  error: string | null;
  ingestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function toDTO(r: KnowledgeSourceRow): KnowledgeSourceDTO {
  return {
    id: r.id,
    title: r.title,
    publisher: r.publisher,
    edition: r.edition,
    sport: r.sport,
    coachId: r.coach_id,
    resourceId: r.resource_id,
    kind: r.kind,
    storagePath: r.storage_path,
    externalUrl: r.external_url,
    chunker: r.chunker,
    rightsBasis: r.rights_basis,
    quoteAllowed: r.quote_allowed,
    embeddingModel: r.embedding_model,
    status: r.status,
    pageCount: r.page_count,
    chunkCount: r.chunk_count,
    error: r.error,
    ingestedAt: r.ingested_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const adminListKnowledgeSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ sources: KnowledgeSourceDTO[] }> => {
    await assertAdmin(context);
    const admin = await adminClient();
    const { data, error } = await admin
      .from("knowledge_sources")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) dbError(error);
    return { sources: ((data ?? []) as KnowledgeSourceRow[]).map(toDTO) };
  });

export type LibraryResourceOption = {
  id: string;
  title: string;
  sport: string;
  storagePath: string;
  coachId: string | null;
  registered: boolean;
};

/** Library PDFs (global and coach-uploaded) an admin can register as sources. */
export const adminListLibraryPdfs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ resources: LibraryResourceOption[] }> => {
    await assertAdmin(context);
    const admin = await adminClient();
    const [res, src] = await Promise.all([
      admin
        .from("resources")
        .select("id, title, sport, storage_path, coach_id")
        .not("storage_path", "is", null)
        .order("title", { ascending: true })
        .limit(500),
      admin.from("knowledge_sources").select("resource_id").not("resource_id", "is", null),
    ]);
    if (res.error) dbError(res.error);
    if (src.error) dbError(src.error);
    const registered = new Set(
      ((src.data ?? []) as Array<{ resource_id: string }>).map((r) => r.resource_id),
    );
    // The six safety PDFs are one file listed under every sport: collapse by storage path.
    const seen = new Set<string>();
    const resources: LibraryResourceOption[] = [];
    for (const r of (res.data ?? []) as Array<{
      id: string;
      title: string;
      sport: string;
      storage_path: string;
      coach_id: string | null;
    }>) {
      if (seen.has(r.storage_path)) continue;
      seen.add(r.storage_path);
      resources.push({
        id: r.id,
        title: r.title,
        sport: r.sport,
        storagePath: r.storage_path,
        coachId: r.coach_id,
        registered: registered.has(r.id),
      });
    }
    return { resources };
  });

export const adminRegisterKnowledgeFromResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ resourceId: z.string().uuid(), ...registerCommon }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = await assertAdmin(context);
    const admin = await adminClient();
    const { data: row, error } = await admin
      .from("resources")
      .select("id, title, sport, storage_path, coach_id")
      .eq("id", data.resourceId)
      .maybeSingle();
    if (error) dbError(error);
    if (!row?.storage_path) throw new Error("That resource has no PDF");
    return registerKnowledgeSource(admin, {
      title: row.title,
      publisher: data.publisher,
      edition: data.edition,
      // A coach's own upload is scoped to that coach and matches any sport.
      sport: row.coach_id ? "all" : data.sport,
      coachId: row.coach_id,
      resourceId: row.id,
      kind: "pdf",
      storagePath: row.storage_path,
      chunker: data.chunker,
      rightsBasis: data.rightsBasis,
      quoteAllowed: data.quoteAllowed,
      createdBy: userId,
    });
  });

/**
 * Register every library PDF that isn't in the corpus yet, in one pass.
 * Each document is tagged with its own sport; a file listed under several
 * sports (the six safety PDFs) is registered once as "all". Coach uploads
 * are left alone — they register themselves on upload, scoped to the coach.
 */
export const adminBulkRegisterLibraryPdfs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        publisher: registerCommon.publisher,
        edition: registerCommon.edition,
        chunker: registerCommon.chunker,
        rightsBasis: registerCommon.rightsBasis,
        quoteAllowed: registerCommon.quoteAllowed,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ registered: number; skipped: number }> => {
    const userId = await assertAdmin(context);
    const admin = await adminClient();
    const [res, src] = await Promise.all([
      admin
        .from("resources")
        .select("id, title, sport, storage_path, coach_id")
        .is("coach_id", null)
        .not("storage_path", "is", null)
        .order("title", { ascending: true })
        .limit(1000),
      admin.from("knowledge_sources").select("storage_path").not("storage_path", "is", null),
    ]);
    if (res.error) dbError(res.error);
    if (src.error) dbError(src.error);

    const already = new Set(
      ((src.data ?? []) as Array<{ storage_path: string }>).map((r) => r.storage_path),
    );

    type Group = { id: string; title: string; sports: Set<string>; storagePath: string };
    const groups = new Map<string, Group>();
    for (const r of (res.data ?? []) as Array<{
      id: string;
      title: string;
      sport: string;
      storage_path: string;
    }>) {
      const g = groups.get(r.storage_path);
      if (g) g.sports.add(r.sport);
      else
        groups.set(r.storage_path, {
          id: r.id,
          title: r.title,
          sports: new Set([r.sport]),
          storagePath: r.storage_path,
        });
    }

    let registered = 0;
    let skipped = 0;
    for (const g of groups.values()) {
      if (already.has(g.storagePath)) {
        skipped += 1;
        continue;
      }
      await registerKnowledgeSource(admin, {
        title: g.title,
        publisher: data.publisher,
        edition: data.edition,
        sport: g.sports.size === 1 ? [...g.sports][0] : "all",
        resourceId: g.id,
        kind: "pdf",
        storagePath: g.storagePath,
        chunker: data.chunker,
        rightsBasis: data.rightsBasis,
        quoteAllowed: data.quoteAllowed,
        createdBy: userId,
      });
      already.add(g.storagePath);
      registered += 1;
    }
    return { registered, skipped };
  });

export const adminRegisterKnowledgeText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().trim().min(1).max(160),
        text: z.string().trim().min(40).max(200_000),
        ...registerCommon,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = await assertAdmin(context);
    const admin = await adminClient();
    return registerKnowledgeSource(admin, {
      title: data.title,
      publisher: data.publisher,
      edition: data.edition,
      sport: data.sport,
      kind: "text",
      inlineText: data.text,
      chunker: data.chunker,
      rightsBasis: data.rightsBasis,
      quoteAllowed: data.quoteAllowed,
      createdBy: userId,
    });
  });

const MAX_URL_PDF_BYTES = 25 * 1024 * 1024;

/** Fetch a public PDF (https only), store it under library/knowledge/, register it. */
export const adminRegisterKnowledgeFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        url: z.string().url().max(2000),
        title: z.string().trim().min(1).max(160),
        ...registerCommon,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = await assertAdmin(context);
    const url = new URL(data.url);
    if (url.protocol !== "https:") throw new Error("Only https URLs are accepted");
    const res = await fetch(url.toString(), {
      redirect: "follow",
      headers: { Accept: "application/pdf" },
    });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_URL_PDF_BYTES) throw new Error("PDF is larger than 25 MB");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_URL_PDF_BYTES) throw new Error("PDF is larger than 25 MB");
    const magic = String.fromCharCode(...bytes.slice(0, 4));
    if (magic !== "%PDF") throw new Error("That URL did not return a PDF");

    const admin = await adminClient();
    const path = `library/knowledge/${crypto.randomUUID()}.pdf`;
    const up = await admin.storage
      .from(KNOWLEDGE_BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (up.error) throw new Error(`Upload failed: ${up.error.message}`);

    return registerKnowledgeSource(admin, {
      title: data.title,
      publisher: data.publisher,
      edition: data.edition,
      sport: data.sport,
      kind: "pdf",
      storagePath: path,
      externalUrl: url.toString(),
      chunker: data.chunker,
      rightsBasis: data.rightsBasis,
      quoteAllowed: data.quoteAllowed,
      createdBy: userId,
    });
  });

export const adminRequeueKnowledgeSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    await requeueKnowledgeSource(await adminClient(), data.id);
    return { ok: true as const };
  });

export const adminDeleteKnowledgeSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const admin = await adminClient();
    const { data: row, error } = await admin
      .from("knowledge_sources")
      .select("storage_path, resource_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) dbError(error);
    const del = await admin.from("knowledge_sources").delete().eq("id", data.id);
    if (del.error) dbError(del.error);
    // Only files this panel fetched by URL belong to the corpus alone; library
    // and coach uploads stay because the resource still lists them.
    const path = row?.storage_path as string | null | undefined;
    if (path && !row?.resource_id && path.startsWith("library/knowledge/")) {
      await admin.storage.from(KNOWLEDGE_BUCKET).remove([path]);
    }
    return { ok: true as const };
  });

/** Take ingest steps now instead of waiting for the next cron tick. */
export const adminRunKnowledgeIngestNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const admin = await adminClient();
    return runKnowledgeIngest({ admin, env: process.env }, { maxMs: 20_000 });
  });

export const adminSearchKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        question: z.string().trim().min(2).max(2000),
        sport: sportSchema.default("all"),
        coachIds: z.array(z.string().uuid()).max(10).default([]),
        limit: z.number().int().min(1).max(20).default(8),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ hits: KnowledgeHit[] }> => {
    await assertAdmin(context);
    const admin = await adminClient();
    const hits = await retrieveKnowledge({
      admin,
      embed: createGatewayEmbedder(process.env),
      question: data.question,
      sport: data.sport,
      coachIds: data.coachIds,
      limit: data.limit,
    });
    return { hits };
  });

export type KnownAnswerResult = {
  question: string;
  sport: string;
  titleContains: string;
  outcome: "hit" | "miss" | "skipped";
  /** Titles of the top-3 hits, for a miss. */
  top: string[];
};

/** Run docs/knowledge's known-answer set: expected source in the top 3. */
export const adminRunKnownAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      results: KnownAnswerResult[];
      hits: number;
      scored: number;
      skipped: number;
    }> => {
      await assertAdmin(context);
      const admin = await adminClient();
      const { data: ready, error } = await admin
        .from("knowledge_sources")
        .select("title")
        .eq("status", "ready");
      if (error) dbError(error);
      const readyTitles = ((ready ?? []) as Array<{ title: string }>).map((r) =>
        r.title.toLowerCase(),
      );
      const embed = createGatewayEmbedder(process.env);
      const results: KnownAnswerResult[] = [];
      for (const c of KNOWN_ANSWER_CASES) {
        const needle = c.titleContains.toLowerCase();
        if (!readyTitles.some((t) => t.includes(needle))) {
          results.push({ ...c, outcome: "skipped", top: [] });
          continue;
        }
        const hits = await retrieveKnowledge({
          admin,
          embed,
          question: c.question,
          sport: c.sport,
          limit: 3,
        });
        const top = hits.map((h) => h.title);
        const hit = top.some((t) => t.toLowerCase().includes(needle));
        results.push({ ...c, outcome: hit ? "hit" : "miss", top });
      }
      const scored = results.filter((r) => r.outcome !== "skipped").length;
      const hits = results.filter((r) => r.outcome === "hit").length;
      return { results, hits, scored, skipped: results.length - scored };
    },
  );
