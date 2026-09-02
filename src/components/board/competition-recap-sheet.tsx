import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  submitCompetitionRecap,
  getRecapCoaches,
  type PendingRecapDTO,
} from "@/lib/competition-recap.functions";

/**
 * One question, one text box. The recap is stored on the athlete's record and
 * sent to the coaches the author picks, so we keep the ask as small as possible.
 */
export function CompetitionRecapSheet({
  pending,
  open,
  onOpenChange,
  onDone,
}: {
  pending: PendingRecapDTO;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const submit = useServerFn(submitCompetitionRecap);
  const loadCoaches = useServerFn(getRecapCoaches);
  const [body, setBody] = useState("");
  const [athleteId, setAthleteId] = useState<string | null>(pending.athleteId);
  const [coachIds, setCoachIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setBody("");
      setAthleteId(pending.athleteId);
    }
  }, [open, pending.athleteId]);

  const coaches = useQuery({
    queryKey: ["recap-coaches", athleteId],
    enabled: open && !!athleteId,
    queryFn: () => loadCoaches({ data: { athleteId: athleteId! } }),
  });

  // Default to sending to everyone on the roster.
  useEffect(() => {
    if (coaches.data) setCoachIds(coaches.data.map((c) => c.id));
  }, [coaches.data]);

  const toggleCoach = (id: string) =>
    setCoachIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const send = useMutation({
    mutationFn: () =>
      submit({
        data: {
          competitionId: pending.competitionId,
          athleteId: athleteId!,
          body: body.trim(),
          coachIds,
        },
      }),
    onSuccess: () => {
      toast.success(
        coachIds.length === 1 ? "Recap saved and sent to your coach" : "Recap saved and sent",
      );
      onOpenChange(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const coachList = coaches.data ?? [];
  const canSubmit =
    !!athleteId &&
    body.trim().length > 0 &&
    !send.isPending &&
    (coachList.length === 0 || coachIds.length > 0);


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="paper-surface max-h-[85dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <p className="text-[11px] font-black uppercase tracking-widest text-accent-ink">
            {pending.competitionName}
          </p>
          <SheetTitle className="font-display text-h3 text-text-primary">
            How did the competition go?
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 pb-6">
          {pending.athleteChoices.length > 0 && (
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-text-secondary">
                Who is this about?
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {pending.athleteChoices.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAthleteId(a.id)}
                    className={cn(
                      "press-soft rounded-pill border px-3 py-1.5 text-sm",
                      athleteId === a.id
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-divider bg-card text-text-primary",
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {coachList.length > 0 && (
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-text-secondary">
                Send to
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {coachList.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCoach(c.id)}
                    className={cn(
                      "press-soft rounded-pill border px-3 py-1.5 text-sm",
                      coachIds.includes(c.id)
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-divider bg-card text-text-secondary",
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm text-text-tertiary">
                {coachIds.length === coachList.length
                  ? "Goes to every coach on the roster. Tap a coach to leave them out."
                  : `Goes to ${coachIds.length} of ${coachList.length} coaches.`}
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="competition-recap-body"
              className="text-[11px] font-black uppercase tracking-widest text-text-secondary"
            >
              Your recap
            </label>
            <p className="mt-1 text-sm text-text-tertiary">
              What went well? What didn&apos;t go well? Share any feedback with your coach.
            </p>
            <textarea
              id="competition-recap-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={2000}
              className="focus-input mt-2 w-full resize-none rounded-xl border border-divider bg-elevated px-3 py-2 text-[15px] leading-relaxed text-text-primary placeholder:text-text-tertiary"
            />
          </div>

          <Button
            type="button"
            className="w-full"
            disabled={!canSubmit}
            onClick={() => send.mutate()}
          >
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {coachList.length > 1 && coachIds.length !== 1
              ? `Send to ${coachIds.length} coaches`
              : "Send to my coach"}
          </Button>

        </div>
      </SheetContent>
    </Sheet>
  );
}
