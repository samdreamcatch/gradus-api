import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Trophy } from "lucide-react";
import { toast } from "sonner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScoreSheet } from "@/components/board/score-sheet";

import {
  getAthleteCompetitionResults,
  listFinishedCompetitions,
  listSkaterMatches,
  linkAthleteToSkater,
  unlinkAthleteCompetition,
  generatePlanFromResults,
  type AthleteResultDTO,
  type SkaterMatchDTO,
} from "@/lib/competition-results.functions";

import type { BoardSkater } from "@/lib/board-types";

/** Competitions shown before the coach asks for the full season history. */
const VISIBLE_LIMIT = 5;

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** Closed-folder summary: how many events, and the best placement of them. */
function summarize(results: AthleteResultDTO[]): string {
  const count = results.length;
  const label = count === 1 ? "1 event" : `${count} events`;
  const places = results
    .map((r) => Number.parseInt(r.placement, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!count) return "no scores";
  if (!places.length) return label;
  return `${label} · best ${ordinal(Math.min(...places))}`;
}


/**
 * Competition results for one athlete, private to their circle. Linking starts
 * from the coach's own roster — never from the public board — so a follower can
 * never learn that a skater has a Gradus account.
 */
export function CompetitionResultsSection({
  athleteId,
  firstName,
}: {
  athleteId: string;
  firstName: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchResults = useServerFn(getAthleteCompetitionResults);
  const generate = useServerFn(generatePlanFromResults);
  const unlink = useServerFn(unlinkAthleteCompetition);

  const [linkOpen, setLinkOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [detail, setDetail] = useState<AthleteResultDTO | null>(null);


  const results = useQuery({
    queryKey: ["athlete-competition-results", athleteId],
    queryFn: () => fetchResults({ data: { athleteId } }),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["athlete-competition-results", athleteId] });
    void qc.invalidateQueries({ queryKey: ["coach-athlete-detail", athleteId] });
  };

  const draft = useMutation({
    mutationFn: (competitionId: string) => generate({ data: { athleteId, competitionId } }),
    onSuccess: (r) => {
      toast.success(`Draft plan "${r.title}" created with ${r.moveCount} moves`);
      invalidate();
      void navigate({ to: "/coach/plans/$planId", params: { planId: r.planId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (competitionId: string) => unlink({ data: { athleteId, competitionId } }),
    onSuccess: () => {
      toast.success("Competition unlinked");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const links = results.data ?? [];
  const visible = showAll ? links : links.slice(0, VISIBLE_LIMIT);


  return (
    <section>
      <div className="flex items-center justify-between">
        <Eyebrow size="micro" tone="tertiary" as="h3">
          Competition results
        </Eyebrow>

        <Button type="button" size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
          Link results
        </Button>
      </div>

      {results.isLoading ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-text-tertiary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading results…
        </div>
      ) : links.length === 0 ? (
        <p className="mt-2 text-sm text-text-secondary">
          No competition results linked for {firstName} yet.
        </p>
      ) : (
        <>
          <Accordion
            type="single"
            collapsible
            defaultValue={links[0]?.competitionId}
            className="mt-2 overflow-hidden rounded-xl border border-divider bg-card"
          >
            {visible.map((l) => (
              <AccordionItem
                key={l.competitionId}
                value={l.competitionId}
                className="border-b border-divider last:border-b-0"
              >
                <AccordionTrigger className="press-soft gap-3 px-4 py-3 hover:no-underline">
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-display text-base text-text-primary">
                        {l.competitionName}
                      </span>
                      <span className="block font-mono text-[11px] text-text-tertiary">
                        {l.datesLabel}
                      </span>
                    </span>
                    <Tag size="micro" tone="muted" className="shrink-0">
                      {summarize(l.results)}
                    </Tag>
                  </span>
                </AccordionTrigger>

                <AccordionContent className="px-4 pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate font-mono text-[11px] text-text-tertiary">
                      {[l.skaterName, l.club].filter(Boolean).join(" · ")}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(l.competitionId)}
                    >
                      Unlink
                    </Button>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    {l.results.length === 0 ? (
                      <p className="text-sm text-text-secondary">No published scores found.</p>
                    ) : (
                      l.results.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setDetail(r)}
                          className="press-soft flex w-full items-center justify-between gap-3 rounded-lg border border-divider bg-elevated px-3 py-2 text-left"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-text-primary">
                              {r.eventName}
                            </span>
                            <span className="block font-mono text-[10px] uppercase tracking-widest text-text-tertiary">
                              {[r.segment, r.rink].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-mono text-sm tabular-nums text-text-primary">
                              {r.totalScore || r.segmentScore || "—"}
                            </span>
                            <span className="block font-mono text-[10px] uppercase tracking-widest text-text-tertiary">
                              {r.placement ? `place ${r.placement}` : ""}
                            </span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    className="mt-3 w-full"
                    disabled={draft.isPending || l.results.length === 0}
                    onClick={() => draft.mutate(l.competitionId)}
                  >
                    {draft.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    Generate draft plan
                  </Button>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          {links.length > VISIBLE_LIMIT ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show recent" : `Show all ${links.length}`}
            </Button>
          ) : null}
        </>
      )}


      <LinkCompetitionSheet
        athleteId={athleteId}
        firstName={firstName}
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onLinked={invalidate}
      />

      <ScoreSheet
        skater={
          detail
            ? ({
                name: detail.eventName,
                club: detail.rink,
                protocol: detail.protocol,
              } as unknown as BoardSkater)
            : null
        }
        eventLabel={detail ? [detail.segment, detail.placement].filter(Boolean).join(" · ") : ""}
        onOpenChange={(v) => {
          if (!v) setDetail(null);
        }}
      />
    </section>
  );
}


/** Pick a finished competition, then confirm which published skater is theirs. */
function LinkCompetitionSheet({
  athleteId,
  firstName,
  open,
  onOpenChange,
  onLinked,
}: {
  athleteId: string;
  firstName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onLinked: () => void;
}) {
  const fetchComps = useServerFn(listFinishedCompetitions);
  const fetchMatches = useServerFn(listSkaterMatches);
  const link = useServerFn(linkAthleteToSkater);

  const [competitionId, setCompetitionId] = useState<string | null>(null);

  const comps = useQuery({
    queryKey: ["finished-competitions", athleteId],
    queryFn: () => fetchComps({ data: { athleteId } }),
    enabled: open,
  });

  const matches = useQuery({
    queryKey: ["skater-matches", athleteId, competitionId],
    queryFn: () => fetchMatches({ data: { athleteId, competitionId: competitionId! } }),
    enabled: open && !!competitionId,
  });

  const confirm = useMutation({
    mutationFn: (m: SkaterMatchDTO) =>
      link({
        data: {
          athleteId,
          competitionId: competitionId!,
          skaterName: m.name,
          club: m.club,
          files: [...new Set(m.events.map((e) => e.file))].slice(0, 12),
        },
      }),
    onSuccess: (r) => {
      toast.success(`Linked ${r.linked} result${r.linked === 1 ? "" : "s"}`);
      setCompetitionId(null);
      onOpenChange(false);
      onLinked();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) setCompetitionId(null);
        onOpenChange(v);
      }}
    >
      <SheetContent side="bottom" className="paper-surface max-h-[85dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-h3 text-text-primary">
            {competitionId ? `Which skater is ${firstName}?` : "Link competition results"}
          </SheetTitle>
        </SheetHeader>

        {!competitionId ? (
          <div className="space-y-2 pb-6">
            {comps.isLoading ? (
              <Loading label="Loading finished competitions…" />
            ) : (comps.data ?? []).length === 0 ? (
              <p className="text-sm text-text-secondary">
                No finished competitions are available yet.
              </p>
            ) : (
              comps.data!.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCompetitionId(c.id)}
                  className="press-soft w-full rounded-xl border border-divider bg-card px-4 py-3 text-left"
                >
                  <span className="block text-sm text-text-primary">{c.name}</span>
                  <span className="block font-mono text-[10px] uppercase tracking-widest text-text-tertiary">
                    {[c.datesLabel, c.location].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-2 pb-6">
            <p className="text-xs text-text-tertiary">
              Only you can see this link. It is not shown on the public board.
            </p>
            {matches.isLoading ? (
              <Loading label="Reading the published results…" />
            ) : matches.error ? (
              <p className="text-sm text-text-secondary">
                Couldn't read that competition's results.
              </p>
            ) : (matches.data ?? []).length === 0 ? (
              <p className="text-sm text-text-secondary">
                No skater in that competition matches {firstName}.
              </p>
            ) : (
              matches.data!.map((m) => (
                <button
                  key={m.name}
                  type="button"
                  disabled={confirm.isPending}
                  onClick={() => confirm.mutate(m)}
                  className="press-soft w-full rounded-xl border border-divider bg-card px-4 py-3 text-left disabled:opacity-50"
                >
                  <span className="block text-sm text-text-primary">{m.name}</span>
                  <span className="block font-mono text-[10px] uppercase tracking-widest text-text-tertiary">
                    {[m.club, `${m.events.length} event${m.events.length === 1 ? "" : "s"}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setCompetitionId(null)}
            >
              Back
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-text-tertiary">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}
