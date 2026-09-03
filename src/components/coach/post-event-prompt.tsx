import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Sparkles, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  getCoachPostEventItems,
  dismissCoachPostEvent,
  listCoachRosterForCompetition,
  listSkaterMatches,
  linkAthleteToSkater,
  generatePlanFromResults,
  type CoachPostEventItemDTO,
  type SkaterMatchDTO,
} from "@/lib/competition-results.functions";


/**
 * Coaches who watched a live board get asked, once the event is over, whether
 * any of their rostered athletes competed there — and then link them to the
 * published skaters. Linking always starts from the coach's own roster.
 */
export function CoachPostEventPrompt() {
  const fetchItems = useServerFn(getCoachPostEventItems);
  const dismiss = useServerFn(dismissCoachPostEvent);
  const generate = useServerFn(generatePlanFromResults);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [active, setActive] = useState<CoachPostEventItemDTO | null>(null);

  const items = useQuery({
    queryKey: ["coach-post-event-items"],
    queryFn: () => fetchItems(),
  });

  const dismissOne = useMutation({
    mutationFn: (competitionId: string) => dismiss({ data: { competitionId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["coach-post-event-items"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const draft = useMutation({
    mutationFn: (v: { athleteId: string; competitionId: string }) =>
      generate({ data: { athleteId: v.athleteId, competitionId: v.competitionId } }),
    onSuccess: (r) => {
      toast.success(`Draft plan "${r.title}" created with ${r.moveCount} moves`);
      void qc.invalidateQueries({ queryKey: ["coach-post-event-items"] });
      void navigate({ to: "/coach/plans/$planId", params: { planId: r.planId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const item = (items.data ?? [])[0];
  if (!item) return null;

  return (
    <>
      <Card variant="section" className="mb-4">
        <SectionHeader title={`${item.competitionName} has ended`} />
        <p className="mt-2 text-sm text-text-primary">
          Did any of your athletes compete at {item.competitionName}?
        </p>
        {item.linked.length ? (
          <ul className="mt-3 space-y-2">
            {item.linked.map((a) => (
              <Card
                as="li"
                variant="row"
                key={a.athleteId}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="min-w-0 text-sm text-text-secondary">
                  <Check className="mr-1 inline h-3 w-3 text-accent-ink" aria-hidden />
                  {a.name}
                  {a.summary ? ` — ${a.summary}` : ""}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={draft.isPending}
                  onClick={() =>
                    draft.mutate({ athleteId: a.athleteId, competitionId: item.competitionId })
                  }
                >
                  {draft.isPending && draft.variables?.athleteId === a.athleteId ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Sparkles />
                  )}
                  Draft plan
                </Button>
              </Card>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => setActive(item)}>
            {item.linked.length ? "Link more athletes" : "Yes, link athletes"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-text-secondary"
            disabled={dismissOne.isPending}
            onClick={() => dismissOne.mutate(item.competitionId)}
          >
            {item.linked.length ? "Done" : "No"}
          </Button>
        </div>
      </Card>




      <LinkRosterSheet
        item={active}
        onOpenChange={(v) => {
          if (!v) setActive(null);
        }}
        onLinked={() => void qc.invalidateQueries({ queryKey: ["coach-post-event-items"] })}
      />
    </>
  );
}

/** Pick a rostered athlete, then confirm which published skater they are. */
function LinkRosterSheet({
  item,
  onOpenChange,
  onLinked,
}: {
  item: CoachPostEventItemDTO | null;
  onOpenChange: (v: boolean) => void;
  onLinked: () => void;
}) {
  const fetchRoster = useServerFn(listCoachRosterForCompetition);
  const fetchMatches = useServerFn(listSkaterMatches);
  const link = useServerFn(linkAthleteToSkater);
  const qc = useQueryClient();

  const [athlete, setAthlete] = useState<{ id: string; name: string } | null>(null);
  const competitionId = item?.competitionId ?? null;

  const roster = useQuery({
    queryKey: ["coach-post-event-roster", competitionId],
    queryFn: () => fetchRoster({ data: { competitionId: competitionId! } }),
    enabled: !!competitionId,
  });

  const matches = useQuery({
    queryKey: ["skater-matches", athlete?.id, competitionId],
    queryFn: () => fetchMatches({ data: { athleteId: athlete!.id, competitionId: competitionId! } }),
    enabled: !!competitionId && !!athlete,
  });

  const confirm = useMutation({
    mutationFn: (m: SkaterMatchDTO) =>
      link({
        data: {
          athleteId: athlete!.id,
          competitionId: competitionId!,
          skaterName: m.name,
          club: m.club,
          files: [...new Set(m.events.map((e) => e.file))].slice(0, 12),
        },
      }),
    onSuccess: (r) => {
      toast.success(`Linked ${r.linked} result${r.linked === 1 ? "" : "s"}`);
      void qc.invalidateQueries({ queryKey: ["coach-post-event-roster", competitionId] });
      setAthlete(null);
      onLinked();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet
      open={!!item}
      onOpenChange={(v) => {
        if (!v) setAthlete(null);
        onOpenChange(v);
      }}
    >
      <SheetContent side="bottom" className="paper-surface max-h-[85dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-h3 text-text-primary">
            {athlete ? `Which skater is ${athlete.name}?` : `Who competed at ${item?.competitionName ?? "this event"}?`}
          </SheetTitle>
        </SheetHeader>

        {!athlete ? (
          <div className="space-y-2 pb-6">
            {roster.isLoading ? (
              <Loading label="Loading your roster…" />
            ) : (roster.data ?? []).length === 0 ? (
              <p className="text-sm text-text-secondary">No athletes on your roster yet.</p>
            ) : (
              roster.data!.map((a) => (
                <button
                  key={a.athleteId}
                  type="button"
                  onClick={() => setAthlete({ id: a.athleteId, name: a.name })}
                  className="press-soft flex w-full items-center justify-between gap-2 rounded-xl border border-divider bg-card px-4 py-3 text-left"
                >
                  <span className="text-sm text-text-primary">{a.name}</span>
                  {a.linked ? (
                    <span className="font-mono text-[10px] uppercase tracking-widest text-text-tertiary">
                      Linked
                    </span>
                  ) : null}
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
              <p className="text-sm text-text-secondary">Couldn't read that competition's results.</p>
            ) : (matches.data ?? []).length === 0 ? (
              <p className="text-sm text-text-secondary">
                No skater in that competition matches {athlete.name}.
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
              className="mt-2 rounded-pill"
              onClick={() => setAthlete(null)}
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
