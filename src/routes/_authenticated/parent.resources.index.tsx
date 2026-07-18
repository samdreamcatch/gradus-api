import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, ChevronDown, ExternalLink, FileText, Image as ImageIcon, Link as LinkIcon, Loader2, Search, Sparkles, Trash2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AnswerMarkdown } from "@/components/parent/answer-markdown";

import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { PageTitle } from "@/components/page-title";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import { FilterBar } from "@/components/plans/filter-bar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getSport, type SportKey } from "@/lib/coach-sports";
import {
  getParentResources,
  getResourceSignedUrl,
  type ResourceDTO,
} from "@/lib/parent-resources.functions";
import { askGradus } from "@/lib/ask-gradus.functions";
import {
  listSavedAnswers,
  saveAnswer,
  deleteSavedAnswer,
  type SavedAnswerDTO,
} from "@/lib/saved-answers.functions";

export const Route = createFileRoute("/_authenticated/parent/resources/")({
  component: ParentResourcesPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-3 py-6">
      <div className="rounded-2xl border border-divider bg-card p-6 text-sm text-text-secondary">
        Couldn&apos;t load resources: {error.message}
      </div>
    </div>
  ),
});

function sportLabel(sport: string): string {
  return getSport(sport as SportKey)?.label ?? sport;
}

function ParentResourcesPage() {
  const fetchResources = useServerFn(getParentResources);
  const { data, isLoading } = useQuery({
    queryKey: ["parent-resources"],
    queryFn: () => fetchResources(),
  });

  const sports = data?.sports ?? [];
  const resources = data?.resources ?? [];

  const [selectedSport, setSelectedSport] = useState<string | null>(null);
  const activeSport = selectedSport ?? sports[0] ?? null;

  const [view, setView] = useState<"ask" | "library" | "saved">("library");
  const [search, setSearch] = useState("");
  const [openResource, setOpenResource] = useState<ResourceDTO | null>(null);

  const filtered = useMemo(() => {
    if (!activeSport) return [] as ResourceDTO[];
    const q = search.trim().toLowerCase();
    return resources
      .filter((r) => r.sports.includes(activeSport))
      .filter(
        (r) =>
          !q ||
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      );
  }, [resources, activeSport, search]);

  const coachItems = filtered.filter((r) => r.source === "coach");
  const libraryItems = filtered.filter((r) => r.source === "library");

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-24">
      <PageTitle>Resources</PageTitle>

      {sports.length > 0 ? (
        <FilterBar className="mt-4">
          <SegmentedToggle
            value={view}
            onChange={setView}
            options={[
              { key: "library", label: "Library" },
              { key: "ask", label: "Ask Gradus" },
              { key: "saved", label: "Saved" },
            ]}
          />
          {sports.length > 1 ? (
            <div className="mt-2.5">
              <Select
                value={activeSport ?? undefined}
                onValueChange={(v) => setSelectedSport(v)}
              >
                <SelectTrigger
                  className="h-8 w-full rounded-full border-divider bg-card px-3 text-xs font-bold text-text-primary shadow-none"
                  aria-label="Sport"
                >
                  <SelectValue placeholder="Select sport" />
                </SelectTrigger>
                <SelectContent>
                  {sports.map((s) => (
                    <SelectItem key={s} value={s}>
                      {sportLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </FilterBar>
      ) : null}

      {isLoading ? (
        <p className="mt-8 py-5 text-center text-sm text-text-secondary">Loading…</p>
      ) : sports.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
          <p className="font-hand text-2xl text-text-secondary">
            Add an athlete with a sport to see resources.
          </p>
        </div>
      ) : (
        <>
          {view === "ask" ? (
            <AskGradusCard sport={activeSport!} />
          ) : view === "saved" ? (
            <SavedAnswersList sport={activeSport!} />
          ) : (
            <section className="mt-5 space-y-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
                  aria-hidden
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${sportLabel(activeSport!).toLowerCase()} library`}
                  className="h-11 rounded-2xl border-divider bg-card pl-9 text-sm"
                />
              </div>

              {filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
                  <p className="font-hand text-2xl text-text-secondary">
                    {search
                      ? "No resources match that search."
                      : `No ${sportLabel(activeSport!).toLowerCase()} resources yet.`}
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  {coachItems.length > 0 ? (
                    <div className="space-y-2">
                      <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                        From your coaches
                      </p>
                      <ResourceList
                        rows={coachItems}
                        onOpen={setOpenResource}
                        showCoach
                      />
                    </div>
                  ) : null}
                  {libraryItems.length > 0 ? (
                    <div className="space-y-2">
                      {coachItems.length > 0 ? (
                        <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                          Gradus library
                        </p>
                      ) : null}
                      <ResourceList rows={libraryItems} onOpen={setOpenResource} />
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <ResourceSheet
        resource={openResource}
        onClose={() => setOpenResource(null)}
      />

      <ParentBottomNav />
    </div>
  );
}

function AskGradusCard({ sport }: { sport: string }) {
  const [question, setQuestion] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [saved, setSaved] = useState(false);

  const ask = useServerFn(askGradus);
  const save = useServerFn(saveAnswer);
  const qc = useQueryClient();

  const askMutation = useMutation({
    mutationFn: (q: string) => ask({ data: { sport, question: q } }),
    onSuccess: (_, q) => {
      setLastQuestion(q);
      setSaved(false);
    },
  });

  const saveMutation = useMutation({
    mutationFn: (vars: { question: string; answer: string }) =>
      save({ data: { sport, ...vars } }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["saved-answers"] });
    },
  });

  // Reset answer when the sport changes
  useEffect(() => {
    askMutation.reset();
    saveMutation.reset();
    setQuestion("");
    setLastQuestion("");
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  const onSubmit = () => {
    const q = question.trim();
    if (!q || askMutation.isPending) return;
    askMutation.mutate(q);
  };

  return (
    <section className="mt-5">
      <div className="ask-glow rounded-2xl border border-divider bg-card p-4">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`Ask about a move, drill, or competition in ${sportLabel(sport).toLowerCase()}`}
          className="min-h-[88px] resize-none border-divider bg-transparent text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!question.trim() || askMutation.isPending}
            className="rounded-full"
          >
            {askMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Thinking
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden />
                Ask
              </>
            )}
          </Button>
        </div>
      </div>

      {askMutation.error ? (
        <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {(askMutation.error as Error).message || "Something went wrong asking Gradus."}
        </div>
      ) : null}

      {askMutation.data ? (
        <article className="mt-3 rounded-2xl border border-divider bg-card p-4">
          {lastQuestion ? (
            <p className="mb-3 border-l-2 border-accent/40 pl-3 text-sm font-medium text-text-secondary">
              {lastQuestion}
            </p>
          ) : null}
          <AnswerMarkdown>{askMutation.data.answer}</AnswerMarkdown>
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-divider pt-3">
            <button
              type="button"
              onClick={() => {
                askMutation.reset();
                saveMutation.reset();
                setQuestion("");
                setLastQuestion("");
                setSaved(false);
              }}
              className="font-sans text-[11px] font-bold uppercase tracking-widest text-text-secondary hover:text-text-primary"
            >
              New question
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saved || saveMutation.isPending}
              onClick={() =>
                saveMutation.mutate({
                  question: lastQuestion,
                  answer: askMutation.data!.answer,
                })
              }
              className="rounded-full"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Saving
                </>
              ) : saved ? (
                <>
                  <Check className="h-4 w-4" aria-hidden />
                  Saved
                </>
              ) : (
                <>
                  <BookmarkPlus className="h-4 w-4" aria-hidden />
                  Save
                </>
              )}
            </Button>
          </div>
          {saveMutation.error ? (
            <p className="mt-2 text-xs text-destructive">
              {(saveMutation.error as Error).message || "Couldn't save answer."}
            </p>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

function SavedAnswersList({ sport }: { sport: string }) {
  const fetchSaved = useServerFn(listSavedAnswers);
  const removeSaved = useServerFn(deleteSavedAnswer);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["saved-answers"],
    queryFn: () => fetchSaved(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeSaved({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-answers"] }),
  });

  const items = useMemo(
    () => (data ?? []).filter((a: SavedAnswerDTO) => a.sport === sport),
    [data, sport],
  );

  if (isLoading) {
    return (
      <p className="mt-5 py-5 text-center text-sm text-text-secondary">Loading…</p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
        <p className="font-hand text-2xl text-text-secondary">
          No saved answers yet. Tap Save on any Ask Gradus reply.
        </p>
      </div>
    );
  }

  return (
    <ul className="mt-5 space-y-3">
      {items.map((a) => (
        <li
          key={a.id}
          className="rounded-2xl border border-divider bg-card"
        >
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full items-center gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-card/60">
              <p className="flex-1 border-l-2 border-accent/40 pl-3 text-sm font-medium text-text-primary">
                {a.question}
              </p>
              <span className="shrink-0 text-[11px] uppercase tracking-widest text-text-tertiary">
                {new Date(a.createdAt).toLocaleDateString()}
              </span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t border-divider px-4 pb-4 pt-4">
                <AnswerMarkdown>{a.answer}</AnswerMarkdown>
                <div className="mt-4 flex items-center justify-end gap-2 border-t border-divider pt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate(a.id)}
                    disabled={remove.isPending && remove.variables === a.id}
                    className="rounded-full text-text-secondary hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Remove
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </li>
      ))}
    </ul>
  );
}

function KindIcon({ kind }: { kind: ResourceDTO["kind"] }) {
  if (kind === "image") return <ImageIcon className="h-4 w-4" aria-hidden />;
  if (kind === "link") return <LinkIcon className="h-4 w-4" aria-hidden />;
  return <FileText className="h-4 w-4" aria-hidden />;
}

function ResourceList({
  rows,
  onOpen,
  showCoach = false,
}: {
  rows: ResourceDTO[];
  onOpen: (r: ResourceDTO) => void;
  showCoach?: boolean;
}) {
  return (
    <ul className="divide-y divide-divider rounded-2xl border border-divider bg-card">
      {rows.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onOpen(r)}
            className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-accent/5 focus-visible:outline-none focus-visible:bg-accent/10"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-text-secondary">
              <KindIcon kind={r.kind} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-text-primary">
                {r.title.split(":")[0]}
              </p>
              {showCoach && r.coachName ? (
                <p className="mt-0.5 truncate text-xs text-text-secondary">
                  Shared by Coach {r.coachName}
                </p>
              ) : null}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ResourceSheet({
  resource,
  onClose,
}: {
  resource: ResourceDTO | null;
  onClose: () => void;
}) {
  const sign = useServerFn(getResourceSignedUrl);
  const { data, isLoading, error } = useQuery({
    queryKey: ["resource-signed-url", resource?.id],
    queryFn: () => sign({ data: { resourceId: resource!.id } }),
    enabled: !!resource,
    staleTime: 60_000,
  });

  const kind = resource?.kind ?? "pdf";

  return (
    <Sheet open={!!resource} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="paper-surface h-[92dvh] rounded-t-3xl border-divider p-0"
      >
        <SheetHeader className="px-5 pt-5 pb-3 text-left">
          <SheetTitle className="text-lg">{resource?.title}</SheetTitle>
          {resource?.description ? (
            <p className="text-sm text-text-secondary">{resource.description}</p>
          ) : null}
          {resource?.coachName ? (
            <p className="text-xs text-text-secondary">
              Shared by Coach {resource.coachName}
            </p>
          ) : null}
        </SheetHeader>
        <div className="h-[calc(92vh-96px)] border-t border-divider bg-card">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-text-secondary">
              Loading…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
              Couldn&apos;t load: {(error as Error).message}
            </div>
          ) : data ? (
            kind === "link" ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
                <p className="text-sm text-text-secondary break-all">{data.url}</p>
                <Button asChild className="rounded-full">
                  <a href={data.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" aria-hidden />
                    Open link
                  </a>
                </Button>
              </div>
            ) : kind === "image" ? (
              <div className="h-full overflow-auto bg-elevated">
                <img
                  src={data.url}
                  alt={resource?.title ?? ""}
                  className="mx-auto max-h-full w-auto"
                />
              </div>
            ) : (
              <iframe
                key={data.url}
                src={data.url}
                title={resource?.title}
                className="h-full w-full"
              />
            )
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
