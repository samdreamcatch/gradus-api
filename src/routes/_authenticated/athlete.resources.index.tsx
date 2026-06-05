import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookmarkPlus,
  Check,
  ChevronDown,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AnswerMarkdown } from "@/components/parent/answer-markdown";

import { AthleteBottomNav } from "@/components/athlete/bottom-nav";
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
import { Textarea } from "@/components/ui/textarea";
import { getSport, type SportKey } from "@/lib/coach-sports";
import { getAthleteResources } from "@/lib/athlete-resources.functions";
import { askGradus } from "@/lib/ask-gradus.functions";
import {
  listSavedAnswers,
  saveAnswer,
  deleteSavedAnswer,
  type SavedAnswerDTO,
} from "@/lib/saved-answers.functions";

export const Route = createFileRoute("/_authenticated/athlete/resources/")({
  component: AthleteResourcesPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-3 py-6">
      <div className="rounded-2xl border border-divider bg-card p-6 text-sm text-text-secondary">
        Couldn&apos;t load resources: {error.message}
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-3 py-6 text-sm text-text-secondary">
      Not found.
    </div>
  ),
});

function sportLabel(sport: string): string {
  return getSport(sport as SportKey)?.label ?? sport;
}

function AthleteResourcesPage() {
  const fetchResources = useServerFn(getAthleteResources);
  const { data, isLoading } = useQuery({
    queryKey: ["athlete-resources"],
    queryFn: () => fetchResources(),
  });

  const sports = data?.sports ?? [];

  const [selectedSport, setSelectedSport] = useState<string | null>(null);
  const activeSport = selectedSport ?? sports[0] ?? null;

  const [view, setView] = useState<"safe-sport" | "ask" | "saved">("safe-sport");

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-24">
      <PageTitle>Resources</PageTitle>

      {sports.length > 0 ? (
        <FilterBar className="mt-4">
          <SegmentedToggle
            value={view}
            onChange={setView}
            options={[
              { key: "safe-sport", label: "Safe Sport" },
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
        <p className="mt-8 py-5 text-center text-sm text-text-secondary">
          Loading…
        </p>
      ) : sports.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
          <p className="font-hand text-2xl text-text-secondary">
            Add a sport to your profile to see resources.
          </p>
        </div>
      ) : (
        <>
          {view === "ask" ? (
            <AskGradusCard sport={activeSport!} />
          ) : view === "saved" ? (
            <SavedAnswersList sport={activeSport!} />
          ) : (
            <SafeSportPanel sport={activeSport!} />
          )}
        </>
      )}

      <AthleteBottomNav />
    </div>
  );
}

function SafeSportPanel({ sport }: { sport: string }) {
  return (
    <section className="mt-5">
      <div className="rounded-2xl border border-divider bg-card p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-ink">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
              Safe Sport
            </p>
            <h2 className="mt-1 font-display text-2xl text-text-primary">
              Train safely, speak up early
            </h2>
            <p className="mt-3 text-sm text-text-secondary">
              A space for athletes to learn about safe training, healthy
              boundaries, and how to raise concerns. Tailored guidance for{" "}
              <span className="pen-highlight">{sportLabel(sport)}</span> is
              coming soon.
            </p>
          </div>
        </div>
      </div>
    </section>
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
          {(askMutation.error as Error).message ||
            "Something went wrong asking Gradus."}
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
      <p className="mt-5 py-5 text-center text-sm text-text-secondary">
        Loading…
      </p>
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
        <li key={a.id} className="rounded-2xl border border-divider bg-card">
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
