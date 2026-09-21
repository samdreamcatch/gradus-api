import { describe, expect, it } from "bun:test";
import {
  EMBED_BATCH,
  EXTRACT_WINDOW,
  ingestStep,
  registerKnowledgeSource,
  requeueKnowledgeSource,
  runKnowledgeIngest,
} from "./knowledge-ingest.server";
import { EMBEDDING_DIMENSIONS } from "./knowledge-embeddings.server";

/**
 * In-memory stand-in for the admin client, covering exactly the query
 * shapes the ingest loop uses: select/insert/upsert/update/delete with
 * eq/in/is/order/limit/maybeSingle/single and `count: "exact", head: true`.
 */
type Row = Record<string, unknown>;

function fakeAdmin(pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])) {
  const tables: Record<string, Row[]> = {
    knowledge_sources: [],
    knowledge_pages: [],
    knowledge_chunks: [],
  };
  const conflictKeys: Record<string, string[]> = { knowledge_pages: ["source_id", "page"] };
  let seq = 0;

  const builder = (table: string) => {
    const rows = () => tables[table]!;
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: Row | Row[] = {};
    let countOnly = false;
    let orderBy: { col: string; asc: boolean } | null = null;
    let lim: number | null = null;
    let mode: "many" | "maybeSingle" | "single" = "many";

    const apply = () => {
      let out = rows().filter((r) => filters.every((f) => f(r)));
      if (orderBy) {
        const { col, asc } = orderBy;
        out = [...out].sort((a, b) =>
          String(a[col]) < String(b[col])
            ? asc
              ? -1
              : 1
            : String(a[col]) > String(b[col])
              ? asc
                ? 1
                : -1
              : 0,
        );
      }
      if (lim !== null) out = out.slice(0, lim);
      return out;
    };

    const exec = async () => {
      if (op === "insert" || op === "upsert") {
        const list: Row[] = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
          id: `id-${++seq}`,
          updated_at: new Date(seq * 1000).toISOString(),
          ...r,
        }));
        if (op === "upsert" && conflictKeys[table]) {
          const keys = conflictKeys[table]!;
          for (const r of list) {
            const idx = rows().findIndex((x) => keys.every((k) => x[k] === r[k]));
            if (idx >= 0) rows()[idx] = { ...rows()[idx], ...r };
            else rows().push(r);
          }
        } else {
          rows().push(...list);
        }
        const data = mode === "single" ? list[0] : list;
        return { data, error: null };
      }
      if (op === "update") {
        const matched = apply();
        for (const r of matched) {
          Object.assign(r, payload as Row, { updated_at: new Date(++seq * 1000).toISOString() });
        }
        return { data: matched, error: null };
      }
      if (op === "delete") {
        const matched = new Set(apply());
        tables[table] = rows().filter((r) => !matched.has(r));
        return { data: null, error: null };
      }
      const out = apply();
      if (countOnly) return { data: null, count: out.length, error: null };
      if (mode === "maybeSingle") return { data: out[0] ?? null, error: null };
      if (mode === "single")
        return { data: out[0] ?? null, error: out[0] ? null : { message: "no row" } };
      return { data: out, error: null };
    };

    const self: Record<string, unknown> = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) countOnly = true;
        if (op === "select") op = "select";
        return self;
      },
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), self),
      upsert: (p: Row | Row[]) => ((op = "upsert"), (payload = p), self),
      update: (p: Row) => ((op = "update"), (payload = p), self),
      delete: () => ((op = "delete"), self),
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), self),
      in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), self),
      is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), self),
      order: (col: string, o?: { ascending?: boolean }) => (
        (orderBy = { col, asc: o?.ascending !== false }),
        self
      ),
      limit: (n: number) => ((lim = n), self),
      maybeSingle: () => ((mode = "maybeSingle"), exec()),
      single: () => ((mode = "single"), exec()),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return self;
  };

  return {
    tables,
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([pdfBytes]), error: null }),
      }),
    },
  };
}

const fakeEmbed = async (texts: string[]) =>
  texts.map((t) =>
    Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? t.length : 0)),
  );

const fakeExtract = (pageCount: number) => async (_bytes: Uint8Array, from: number, to: number) => {
  const pages = [];
  for (let n = from; n < Math.min(to, pageCount + 1); n++) {
    pages.push({
      page: n,
      text: `PAGE ${n} HEADING\n\n${"Rule text for page " + n + ". ".repeat(30)}`,
    });
  }
  return { pageCount, pages };
};

describe("knowledge ingest state machine", () => {
  it("ingests an inline text source to ready with embedded chunks", async () => {
    const admin = fakeAdmin();
    const { id } = await registerKnowledgeSource(admin, {
      title: "Safe Sport panel",
      kind: "text",
      inlineText: "WHAT COUNTS\n\n" + "Someone yells, mocks, or name-calls at you. ".repeat(40),
      rightsBasis: "gradus_owned",
      quoteAllowed: true,
    });
    const report = await runKnowledgeIngest({ admin, embed: fakeEmbed, env: {} });
    const src = admin.tables.knowledge_sources.find((r) => r.id === id)!;
    expect(src.status).toBe("ready");
    expect(report.idle).toBe(true);
    expect(report.steps.map((s) => s.to)).toEqual(["chunking", "embedding", "embedding", "ready"]);
    const chunks = admin.tables.knowledge_chunks.filter((c) => c.source_id === id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(
      chunks.every(
        (c) => typeof c.embedding === "string" && (c.embedding as string).startsWith("["),
      ),
    ).toBe(true);
    expect(chunks[0]!.content).not.toBe("");
    expect(chunks[0]!.page).toBeNull();
    expect(src.embedding_model).toBe("openai/text-embedding-3-small");
  });

  it("extracts a PDF window by window, then scrubs text for a cite-only source", async () => {
    const admin = fakeAdmin();
    const pageCount = EXTRACT_WINDOW * 2 + 10;
    const { id } = await registerKnowledgeSource(admin, {
      title: "Rulebook",
      kind: "pdf",
      storagePath: "library/knowledge/rulebook.pdf",
      chunker: "rules",
      rightsBasis: "pending permission: cite-only",
      quoteAllowed: false,
    });
    const deps = { admin, embed: fakeEmbed, extract: fakeExtract(pageCount), env: {} };

    const s1 = await ingestStep(deps);
    expect(s1?.to).toBe("extracting");
    const s2 = await ingestStep(deps);
    expect(s2?.detail).toBe(`${EXTRACT_WINDOW}/${pageCount} pages`);
    expect(admin.tables.knowledge_pages.length).toBe(EXTRACT_WINDOW);

    const report = await runKnowledgeIngest(deps);
    const src = admin.tables.knowledge_sources.find((r) => r.id === id)!;
    expect(src.status).toBe("ready");
    expect(src.page_count).toBe(pageCount);
    expect(report.steps.some((s) => s.detail.includes("cite-only"))).toBe(true);
    const chunks = admin.tables.knowledge_chunks.filter((c) => c.source_id === id);
    expect(chunks.length).toBe(src.chunk_count);
    expect(chunks.every((c) => c.content === "")).toBe(true);
    expect(chunks.every((c) => typeof c.embedding === "string")).toBe(true);
    expect(chunks.every((c) => (c.section as string).length > 0)).toBe(true);
    expect(admin.tables.knowledge_pages.filter((p) => p.source_id === id).length).toBe(0);
  });

  it("embeds in batches of EMBED_BATCH and keeps page text for a quotable source", async () => {
    const admin = fakeAdmin();
    const { id } = await registerKnowledgeSource(admin, {
      title: "HEADS UP",
      kind: "pdf",
      storagePath: "library/knowledge/heads-up.pdf",
      rightsBasis: "public_domain_us_gov",
      quoteAllowed: true,
    });
    const calls: number[] = [];
    const embed = async (texts: string[]) => (calls.push(texts.length), fakeEmbed(texts));
    await runKnowledgeIngest({ admin, embed, extract: fakeExtract(30), env: {} });
    const src = admin.tables.knowledge_sources.find((r) => r.id === id)!;
    expect(src.status).toBe("ready");
    expect(calls.every((n) => n <= EMBED_BATCH)).toBe(true);
    expect(calls.reduce((a, b) => a + b, 0)).toBe(src.chunk_count);
    expect(admin.tables.knowledge_pages.filter((p) => p.source_id === id).length).toBe(30);
    expect(admin.tables.knowledge_chunks.every((c) => (c.content as string).length > 0)).toBe(true);
  });

  it("records a failure with its message, and a requeue starts over cleanly", async () => {
    const admin = fakeAdmin();
    const { id } = await registerKnowledgeSource(admin, {
      title: "Broken",
      kind: "pdf",
      storagePath: "library/knowledge/broken.pdf",
      rightsBasis: "gradus_owned",
      quoteAllowed: true,
    });
    const boom = async () => {
      throw new Error("pdf.js: bad xref");
    };
    const report = await runKnowledgeIngest({ admin, embed: fakeEmbed, extract: boom, env: {} });
    const src = admin.tables.knowledge_sources.find((r) => r.id === id)!;
    expect(src.status).toBe("failed");
    expect(src.error).toContain("bad xref");
    expect(report.steps[report.steps.length - 1]!.to).toBe("failed");

    await requeueKnowledgeSource(admin, id);
    expect(src.status).toBe("queued");
    expect(src.error).toBeNull();
    await runKnowledgeIngest({ admin, embed: fakeEmbed, extract: fakeExtract(3), env: {} });
    expect(src.status).toBe("ready");
  });

  it("is idle when nothing is queued and refuses a source without a rights basis", async () => {
    const admin = fakeAdmin();
    const report = await runKnowledgeIngest({ admin, embed: fakeEmbed, env: {} });
    expect(report).toMatchObject({ idle: true, steps: [] });
    await expect(
      registerKnowledgeSource(admin, {
        title: "x",
        kind: "text",
        inlineText: "y",
        rightsBasis: " ",
        quoteAllowed: true,
      }),
    ).rejects.toThrow(/rights basis/);
  });
});
