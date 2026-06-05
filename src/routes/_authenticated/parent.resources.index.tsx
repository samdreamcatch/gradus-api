import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Search, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";

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

  const [view, setView] = useState<"ask" | "library">("library");
  const [search, setSearch] = useState("");
  const [openResource, setOpenResource] = useState<ResourceDTO | null>(null);

  const filtered = useMemo(() => {
    if (!activeSport) return [];
    const q = search.trim().toLowerCase();
    return resources
      .filter((r) => r.sport === activeSport)
      .filter(
        (r) =>
          !q ||
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      );
  }, [resources, activeSport, search]);

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-24">
      <PageTitle>Resources</PageTitle>

      {sports.length > 0 ? (
        <FilterBar className="mt-4">
          <SegmentedToggle
            value={view}
            onChange={setView}
            options={[
              { key: "library", label: "Sport library" },
              { key: "ask", label: "Ask Gradus" },
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
                <ul className="space-y-3">
                  {filtered.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setOpenResource(r)}
                        className="w-full rounded-2xl border border-divider bg-card p-4 text-left transition hover:border-accent/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <h3 className="text-base font-semibold text-text-primary">
                          {r.title}
                        </h3>
                        {r.description ? (
                          <p className="mt-1 text-sm text-text-secondary">
                            {r.description}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
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

function SportFilterChipsParent({
  sports,
  selected,
  onSelect,
}: {
  sports: string[];
  selected: string | null;
  onSelect: (sport: string | null) => void;
}) {
  if (sports.length === 1) {
    return (
      <div className="mt-4">
        <span className="inline-block rounded-pill border border-divider bg-card px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-accent-ink">
          {sportLabel(sports[0])}
        </span>
      </div>
    );
  }
  // Library is sport-scoped by definition — no "All" option here.
  const active = selected ?? sports[0];
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {sports.map((s) => {
        const isActive = active === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(s)}
            className={cn(
              "rounded-pill border px-3 py-1 text-[11px] font-bold uppercase tracking-widest transition",
              isActive
                ? "border-accent bg-accent text-accent-foreground"
                : "border-divider bg-card text-text-secondary hover:text-text-primary",
            )}
          >
            {sportLabel(s)}
          </button>
        );
      })}
    </div>
  );
}

function AskGradusCard({ sport }: { sport: string }) {
  const [question, setQuestion] = useState("");
  const ask = useServerFn(askGradus);
  const mutation = useMutation({
    mutationFn: (q: string) => ask({ data: { sport, question: q } }),
  });

  // Reset answer when the sport changes
  useEffect(() => {
    mutation.reset();
    setQuestion("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  const onSubmit = () => {
    const q = question.trim();
    if (!q || mutation.isPending) return;
    mutation.mutate(q);
  };

  return (
    <section className="mt-5">
      <div className="rounded-xl bg-linear-to-br from-secondary-accent via-accent to-secondary-accent p-[2px] shadow-sm">
        <div className="rounded-[26px] bg-card p-4">
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
              disabled={!question.trim() || mutation.isPending}
              className="rounded-full"
            >
              {mutation.isPending ? (
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
      </div>

      {mutation.error ? (
        <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {(mutation.error as Error).message || "Something went wrong asking Gradus."}
        </div>
      ) : null}

      {mutation.data ? (
        <article className="mt-3 rounded-2xl border border-divider bg-card p-4">
          <div className="prose prose-sm max-w-none text-text-primary">
            <ReactMarkdown>{mutation.data.answer}</ReactMarkdown>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                mutation.reset();
                setQuestion("");
              }}
              className="font-sans text-[11px] font-bold uppercase tracking-widest text-text-secondary hover:text-text-primary"
            >
              New question
            </button>
          </div>
        </article>
      ) : null}
    </section>
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

  return (
    <Sheet open={!!resource} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="h-[92vh] rounded-t-3xl border-divider bg-popover p-0"
      >
        <SheetHeader className="px-5 pt-5 pb-3 text-left">
          <SheetTitle className="text-lg">{resource?.title}</SheetTitle>
          {resource?.description ? (
            <p className="text-sm text-text-secondary">{resource.description}</p>
          ) : null}
        </SheetHeader>
        <div className="h-[calc(92vh-96px)] border-t border-divider bg-card">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-text-secondary">
              Loading PDF…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
              Couldn&apos;t load PDF: {(error as Error).message}
            </div>
          ) : data ? (
            <iframe
              key={data.url}
              src={data.url}
              title={resource?.title}
              className="h-full w-full"
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
