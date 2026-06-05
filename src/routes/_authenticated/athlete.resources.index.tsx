import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookmarkPlus,
  Check,
  ChevronDown,
  Globe,
  Heart,
  Loader2,
  MessageSquare,
  Phone,
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

type Hotline = {
  name: string;
  blurb: string;
  tel?: string;
  sms?: string;
  url: string;
  hours: string;
};

const HOTLINES: Hotline[] = [
  {
    name: "U.S. Center for SafeSport",
    blurb:
      "Specifically for sport. You can report something about a coach, teammate, or official — or just ask if something counts.",
    tel: "8663676272",
    url: "https://uscenterforsafesport.org/report-a-concern/",
    hours: "Online 24/7 · Phone Mon–Fri",
  },
  {
    name: "Childhelp National Hotline",
    blurb:
      "Trained counselors for anyone under 18 (or worried about someone under 18). Free, confidential, you don't have to give your name.",
    tel: "18004224453",
    url: "https://www.childhelphotline.org/",
    hours: "Call or text · 24/7",
  },
  {
    name: "Crisis Text Line",
    blurb:
      "If talking out loud feels like too much, text a trained counselor instead. They'll text back.",
    sms: "741741",
    url: "https://www.crisistextline.org/",
    hours: "Text HOME to 741741 · 24/7",
  },
  {
    name: "988 Suicide & Crisis Lifeline",
    blurb:
      "If you're in crisis — about anything, not only sport — call or text 988. You don't have to be in danger to use it.",
    tel: "988",
    sms: "988",
    url: "https://988lifeline.org/",
    hours: "Call or text · 24/7",
  },
];

const COUNTS_ITEMS = [
  "A coach yells, mocks, or names-calls — at you or someone else.",
  "Comments about your body, weight, or what you eat that feel off.",
  "Pressure to train hurt, hide an injury, or push through pain.",
  "Texts, DMs, or photos from an adult in your sport that feel too personal.",
  "Touching that wasn't needed for the move, or that you didn't want.",
  "Being alone with an adult in ways that feel uncomfortable.",
  "Anything that makes you feel scared, small, or like you can't say no.",
];

function formatTel(digits: string): string {
  if (digits.length === 11 && digits.startsWith("1")) {
    return `1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

function SafeSportPanel({ sport }: { sport: string }) {
  return (
    <section className="mt-5 space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-divider bg-card p-6">
        <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
          Safe Sport
        </p>
        <h2 className="mt-1 font-display text-2xl text-text-primary">
          Something feel off?
        </h2>
        <p className="mt-3 text-sm text-text-secondary">
          If practice in{" "}
          <span className="pen-highlight">{sportLabel(sport)}</span> is making
          you feel unsafe, weird, or just not right — you don't have to figure
          it out alone.
        </p>
      </div>

      {/* Reassurance */}
      <div className="rounded-2xl border border-divider bg-card p-5">
        <div className="space-y-2">
          <p className="text-sm text-text-primary">
            You don't have to be sure. You don't have to have proof. You
            don't have to name anyone.
          </p>
          <p className="text-xs text-text-tertiary">
            Talking to someone trained is a normal thing to do — not a big
            deal, not a last resort.
          </p>
        </div>
      </div>

      {/* Hotlines */}
      <div>
        <h3 className="mb-3 px-1 text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
          Talk to someone now
        </h3>
        <ul className="space-y-2">
          {HOTLINES.map((h) => (
            <li key={h.name}>
              <HotlineCard hotline={h} />
            </li>
          ))}
        </ul>
        <p className="mt-3 px-1 text-xs text-text-tertiary">
          These are independent services — not Gradus, and not your coach.
          What you share with them stays with them.
        </p>
      </div>

      <CountsDisclosure />
      <TrustedAdultDisclosure />

      {/* More from SafeSport */}
      <a
        href="https://uscenterforsafesport.org/audience/athletes/"
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-2xl border border-divider bg-card p-4 transition-colors hover:bg-card/60"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-ink">
            <Globe className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">
              More from SafeSport
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              Training videos, athlete toolkits, and resources from the U.S.
              Center for SafeSport.
            </p>
          </div>
        </div>
      </a>

      <p className="px-1 text-xs text-text-tertiary">
        If you or someone else is in immediate danger, call 911.
      </p>
    </section>
  );
}

function HotlineCard({ hotline }: { hotline: Hotline }) {
  return (
    <div className="rounded-2xl border border-divider bg-card p-4">
      <p className="text-sm font-medium text-text-primary">{hotline.name}</p>
      <p className="mt-1 text-xs text-text-tertiary">{hotline.hours}</p>
      <p className="mt-2 text-sm text-text-secondary">{hotline.blurb}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {hotline.tel && (
          <Button
            asChild
            size="sm"
            className="rounded-full"
          >
            <a href={`tel:${hotline.tel}`}>
              <Phone className="h-3.5 w-3.5" aria-hidden />
              Call {formatTel(hotline.tel)}
            </a>
          </Button>
        )}
        {hotline.sms && (
          <Button
            asChild
            variant="outline"
            size="sm"
            className="rounded-full"
          >
            <a href={`sms:${hotline.sms}`}>
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              Text {hotline.sms}
            </a>
          </Button>
        )}
        <Button
          asChild
          variant="outline"
          size="sm"
          className="rounded-full"
        >
          <a href={hotline.url} target="_blank" rel="noopener noreferrer">
            <Globe className="h-3.5 w-3.5" aria-hidden />
            Website
          </a>
        </Button>
      </div>
    </div>
  );
}

function CountsDisclosure() {
  return (
    <Collapsible className="border-t border-divider pt-4">
      <CollapsibleTrigger className="group flex w-full items-center justify-between text-left">
        <span className="text-sm font-medium text-text-primary">
          Not sure if it "counts"?
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3">
        <p className="text-sm text-text-secondary">
          If any of these are happening, it's worth talking to someone. You
          don't have to decide what it is — that's their job.
        </p>
        <ul className="space-y-2">
          {COUNTS_ITEMS.map((t) => (
            <li
              key={t}
              className="flex gap-2 rounded-xl border border-divider bg-card px-3 py-2 text-sm text-text-secondary"
            >
              <span
                aria-hidden
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent"
              />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TrustedAdultDisclosure() {
  return (
    <Collapsible className="border-t border-divider pt-4">
      <CollapsibleTrigger className="group flex w-full items-center justify-between text-left">
        <span className="text-sm font-medium text-text-primary">
          Want to tell an adult you trust?
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3">
        <p className="text-sm text-text-secondary">
          That could be a parent, another coach, a teacher, a doctor, or an
          older sibling. You don't have to have the right words. Try something
          like:
        </p>
        <div className="rounded-2xl border border-divider bg-card p-4">
          <p className="flex items-start gap-2 text-sm italic text-text-secondary">
            <ShieldCheck
              className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink"
              aria-hidden
            />
            <span>
              "Something's been bugging me about practice and I don't really
              know how to explain it. Can we talk for a few minutes?"
            </span>
          </p>
        </div>
        <p className="text-xs text-text-tertiary">
          If the first adult doesn't get it, try another one. That's not on
          you.
        </p>
      </CollapsibleContent>
    </Collapsible>
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
    mutationFn: (q: string) => ask({ data: { sport, question: q, audience: "athlete" } }),
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
