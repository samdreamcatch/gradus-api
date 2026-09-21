import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SPORTS } from "@/lib/coach-sports";
import {
  adminBulkRegisterLibraryPdfs,
  adminDeleteKnowledgeSource,
  adminListKnowledgeSources,
  adminListLibraryPdfs,
  adminRegisterKnowledgeFromResource,
  adminRegisterKnowledgeFromUrl,
  adminRegisterKnowledgeText,
  adminRequeueKnowledgeSource,
  adminRunKnowledgeIngestNow,
  adminRunKnownAnswers,
  adminSearchKnowledge,
  type KnowledgeSourceDTO,
  type KnownAnswerResult,
} from "@/lib/admin-knowledge.functions";
import type { KnowledgeHit } from "@/lib/knowledge-retrieval.server";

export const Route = createFileRoute("/_authenticated/admin/knowledge")({
  component: KnowledgePage,
});

type Common = {
  publisher: string;
  edition: string;
  sport: string;
  chunker: "prose" | "rules";
  rightsBasis: string;
  quoteAllowed: boolean;
};

const emptyCommon = (): Common => ({
  publisher: "Gradus Sports",
  edition: "2026",
  sport: "all",
  chunker: "prose",
  rightsBasis: "gradus_owned",
  quoteAllowed: false,
});

const STATUS_TONE: Record<KnowledgeSourceDTO["status"], "default" | "accent" | "muted"> = {
  queued: "muted",
  extracting: "default",
  chunking: "default",
  embedding: "default",
  ready: "accent",
  failed: "default",
};

function KnowledgePage() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListKnowledgeSources);
  const pdfsFn = useServerFn(adminListLibraryPdfs);
  const fromResourceFn = useServerFn(adminRegisterKnowledgeFromResource);
  const bulkLibraryFn = useServerFn(adminBulkRegisterLibraryPdfs);
  const fromUrlFn = useServerFn(adminRegisterKnowledgeFromUrl);
  const textFn = useServerFn(adminRegisterKnowledgeText);
  const requeueFn = useServerFn(adminRequeueKnowledgeSource);
  const deleteFn = useServerFn(adminDeleteKnowledgeSource);
  const runNowFn = useServerFn(adminRunKnowledgeIngestNow);
  const searchFn = useServerFn(adminSearchKnowledge);
  const knownFn = useServerFn(adminRunKnownAnswers);

  const sources = useQuery({ queryKey: ["admin-knowledge-sources"], queryFn: () => listFn() });
  const pdfs = useQuery({ queryKey: ["admin-knowledge-pdfs"], queryFn: () => pdfsFn() });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-knowledge-sources"] });
    qc.invalidateQueries({ queryKey: ["admin-knowledge-pdfs"] });
  };

  const [mode, setMode] = useState<"library" | "url" | "text">("library");
  const [common, setCommon] = useState<Common>(emptyCommon());
  const [resourceId, setResourceId] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  const register = useMutation({
    mutationFn: async () => {
      if (mode === "library") return fromResourceFn({ data: { resourceId, ...common } });
      if (mode === "url") return fromUrlFn({ data: { url, title, ...common } });
      return textFn({ data: { title, text, ...common } });
    },
    onSuccess: () => {
      toast.success("Source queued");
      setCommon(emptyCommon());
      setResourceId("");
      setUrl("");
      setTitle("");
      setText("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkLibrary = useMutation({
    mutationFn: () =>
      bulkLibraryFn({
        data: {
          publisher: common.publisher,
          edition: common.edition,
          chunker: common.chunker,
          rightsBasis: common.rightsBasis,
          quoteAllowed: common.quoteAllowed,
        },
      }),
    onSuccess: (r) => {
      toast.success(
        `${r.registered} queued${r.skipped ? `, ${r.skipped} already registered` : ""}`,
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runNow = useMutation({
    mutationFn: () => runNowFn(),
    onSuccess: (r) => {
      toast.success(
        r.idle ? `Queue drained (${r.steps.length} steps)` : `${r.steps.length} steps taken`,
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requeue = useMutation({
    mutationFn: (id: string) => requeueFn({ data: { id } }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const [question, setQuestion] = useState("");
  const [searchSport, setSearchSport] = useState("all");
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null);
  const search = useMutation({
    mutationFn: () => searchFn({ data: { question, sport: searchSport } }),
    onSuccess: (r) => setHits(r.hits),
    onError: (e: Error) => toast.error(e.message),
  });

  const [known, setKnown] = useState<{
    results: KnownAnswerResult[];
    hits: number;
    scored: number;
    skipped: number;
  } | null>(null);
  const runKnown = useMutation({
    mutationFn: () => knownFn(),
    onSuccess: setKnown,
    onError: (e: Error) => toast.error(e.message),
  });

  // The list gets long once the whole library is registered: keep it folded
  // away behind a count, with a filter and a "show all" step.
  const [listOpen, setListOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const allSources = sources.data?.sources ?? [];
  const needle = filter.trim().toLowerCase();
  const filtered = allSources.filter((s) => {
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (!needle) return true;
    return [s.title, s.publisher, s.edition, s.sport, s.rightsBasis]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const visible = showAll ? filtered : filtered.slice(0, 10);

  const canRegister =
    common.rightsBasis.trim().length >= 3 &&
    (mode === "library"
      ? !!resourceId
      : mode === "url"
        ? !!url && !!title
        : !!title && text.trim().length >= 40);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-10">
      <header className="space-y-3">
        <Eyebrow>Content</Eyebrow>
        <h1 className="font-display text-3xl">Knowledge corpus</h1>
        <p className="text-text-secondary max-w-prose">
          What Ask Gradus may answer from. Every source needs a rights basis; a source that may be
          cited but not quoted keeps only its embeddings, sections and pages once it is ready. The
          ledger is <code>docs/knowledge/SOURCES.md</code>.
        </p>
      </header>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="flex items-center gap-2 press-soft"
            onClick={() => setListOpen((v) => !v)}
            aria-expanded={listOpen}
          >
            <ChevronDown
              className={`size-4 transition-transform ${listOpen ? "" : "-rotate-90"}`}
              aria-hidden
            />
            <h2 className="font-display text-xl">Sources</h2>
            <Tag tone="muted">{allSources.length}</Tag>
          </button>
          <Button
            type="button"
            variant="outline"
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
            aria-label="Run ingestion now"
          >
            <Play className="size-4" aria-hidden />
            {runNow.isPending ? "Running…" : "Run ingestion now"}
          </Button>
        </div>
        {sources.isLoading ? (
          <p className="text-text-secondary">Loading…</p>
        ) : !allSources.length ? (
          <p className="text-text-secondary">No sources yet.</p>
        ) : !listOpen ? null : (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
              <Input
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setShowAll(false);
                }}
                placeholder="Search by title, publisher, sport or rights basis"
                aria-label="Search sources"
              />
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v);
                  setShowAll(false);
                }}
              >
                <SelectTrigger aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  {(["queued", "extracting", "chunking", "embedding", "ready", "failed"] as const).map(
                    (s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            {!filtered.length ? (
              <p className="text-text-secondary">No sources match that search.</p>
            ) : (
              <ul className="divide-y divide-divider rounded-lg border border-divider">
                {visible.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.title}</span>
                    {s.edition ? (
                      <span className="text-text-tertiary text-sm">({s.edition})</span>
                    ) : null}
                    <Tag tone={STATUS_TONE[s.status]}>{s.status}</Tag>
                    <Tag tone={s.quoteAllowed ? "accent" : "muted"}>
                      {s.quoteAllowed ? "quotable" : "cite-only"}
                    </Tag>
                    <Tag tone="muted">{s.coachId ? "coach-scoped" : s.sport}</Tag>
                  </div>
                  <p className="text-sm text-text-secondary">
                    {s.publisher || "—"} · {s.kind} · {s.chunker} chunker ·{" "}
                    {s.pageCount != null ? `${s.pageCount} pages · ` : ""}
                    {s.chunkCount} chunks
                    {s.embeddingModel ? ` · ${s.embeddingModel}` : ""}
                  </p>
                  <p className="text-sm text-text-tertiary">Rights: {s.rightsBasis}</p>
                  {s.error ? (
                    <p className="text-sm text-destructive-ink" role="alert">
                      Error: {s.error}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => requeue.mutate(s.id)}
                    aria-label={`Re-ingest ${s.title}`}
                  >
                    <RefreshCw className="size-4" aria-hidden />
                    Re-ingest
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`Remove "${s.title}" from the corpus?`))
                        remove.mutate(s.id);
                    }}
                    aria-label={`Remove ${s.title}`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-xl">Add a source</h2>
        <div className="flex gap-2" role="tablist" aria-label="Source type">
          {(["library", "url", "text"] as const).map((m) => (
            <Button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              variant={mode === m ? "default" : "outline"}
              size="sm"
              onClick={() => setMode(m)}
            >
              {m === "library" ? "Library PDF" : m === "url" ? "Public PDF by URL" : "Text"}
            </Button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {mode === "library" ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="k-resource">Library PDF</Label>
              <Select value={resourceId} onValueChange={setResourceId}>
                <SelectTrigger id="k-resource">
                  <SelectValue placeholder="Choose a PDF already in the library" />
                </SelectTrigger>
                <SelectContent>
                  {(pdfs.data?.resources ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id} disabled={r.registered}>
                      {r.title}
                      {r.coachId ? " (coach upload)" : ""}
                      {r.registered ? " — registered" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {mode === "url" ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="k-url">PDF URL (https)</Label>
              <Input
                id="k-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/document.pdf"
              />
            </div>
          ) : null}
          {mode !== "library" ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="k-title">Title</Label>
              <Input id="k-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          ) : null}
          {mode === "text" ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="k-text">Text</Label>
              <Textarea
                id="k-text"
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="k-publisher">Publisher</Label>
            <Input
              id="k-publisher"
              value={common.publisher}
              onChange={(e) => setCommon({ ...common, publisher: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="k-edition">Edition or year</Label>
            <Input
              id="k-edition"
              value={common.edition}
              onChange={(e) => setCommon({ ...common, edition: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="k-sport">Sport</Label>
            <Select value={common.sport} onValueChange={(v) => setCommon({ ...common, sport: v })}>
              <SelectTrigger id="k-sport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sports</SelectItem>
                {SPORTS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="k-chunker">Chunker</Label>
            <Select
              value={common.chunker}
              onValueChange={(v) => setCommon({ ...common, chunker: v as Common["chunker"] })}
            >
              <SelectTrigger id="k-chunker">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="prose">Prose (guides, handbooks)</SelectItem>
                <SelectItem value="rules">Rules (numbered clauses)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="k-rights">Rights basis (required)</Label>
            <Input
              id="k-rights"
              value={common.rightsBasis}
              onChange={(e) => setCommon({ ...common, rightsBasis: e.target.value })}
              placeholder='e.g. "public_domain_us_gov", "coach_upload", "written permission 2026-10-02 (email from …)", "pending permission: cite-only"'
            />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch
              id="k-quote"
              checked={common.quoteAllowed}
              onCheckedChange={(v) => setCommon({ ...common, quoteAllowed: v })}
            />
            <Label htmlFor="k-quote">Passages may be quoted in answers (off = cite-only)</Label>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => register.mutate()}
            disabled={!canRegister || register.isPending}
          >
            {register.isPending ? "Queuing…" : "Queue for ingestion"}
          </Button>
          {mode === "library" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (
                  window.confirm(
                    "Queue every library PDF that isn't in the corpus yet, each tagged to its own sport?",
                  )
                )
                  bulkLibrary.mutate();
              }}
              disabled={!common.rightsBasis.trim() || bulkLibrary.isPending}
            >
              {bulkLibrary.isPending ? "Queuing…" : "Queue all library PDFs"}
            </Button>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-xl">Check retrieval</h2>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] items-end">
          <div className="space-y-2">
            <Label htmlFor="k-q">Question</Label>
            <Input id="k-q" value={question} onChange={(e) => setQuestion(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="k-qsport">Sport</Label>
            <Select value={searchSport} onValueChange={setSearchSport}>
              <SelectTrigger id="k-qsport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any</SelectItem>
                {SPORTS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            onClick={() => search.mutate()}
            disabled={question.trim().length < 2 || search.isPending}
          >
            <Search className="size-4" aria-hidden />
            Search
          </Button>
        </div>
        {hits ? (
          hits.length ? (
            <ol className="space-y-3">
              {hits.map((h, i) => (
                <li key={h.chunkId} className="rounded-lg border border-divider p-3 space-y-1">
                  <p className="text-sm">
                    <span className="font-medium">
                      [{i + 1}] {h.title}
                    </span>{" "}
                    <span className="text-text-tertiary">
                      {[h.section, h.page ? `p. ${h.page}` : ""].filter(Boolean).join(", ")} ·{" "}
                      {h.similarity.toFixed(3)}
                    </span>
                  </p>
                  <p className="text-sm text-text-secondary">
                    {h.quoteAllowed && h.content
                      ? h.content.slice(0, 400)
                      : "(cite-only source: no stored text)"}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-text-secondary">No matches.</p>
          )
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => runKnown.mutate()}
            disabled={runKnown.isPending}
          >
            {runKnown.isPending ? "Running…" : "Run known-answer set"}
          </Button>
          {known ? (
            <p className="text-sm text-text-secondary">
              {known.hits}/{known.scored} in the top 3
              {known.skipped ? ` · ${known.skipped} skipped (source not ready)` : ""}
            </p>
          ) : null}
        </div>
        {known ? (
          <ul className="divide-y divide-divider rounded-lg border border-divider text-sm">
            {known.results.map((r) => (
              <li key={r.question} className="flex flex-wrap gap-2 p-3">
                <Tag tone={r.outcome === "hit" ? "accent" : "muted"}>{r.outcome}</Tag>
                <span className="flex-1 min-w-0">{r.question}</span>
                <span className="text-text-tertiary">
                  expects “{r.titleContains}”
                  {r.outcome === "miss" ? ` · got ${r.top.join(" | ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
