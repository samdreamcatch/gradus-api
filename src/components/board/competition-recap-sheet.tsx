import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Textarea } from "@/components/ui/textarea";
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
      <SheetContent side="bottom" className="paper-surface max-h-[92dvh] overflow-y-auto">
        <SheetHeader className="px-1 pb-2 text-left">
          <Eyebrow size="caption" weight="black" tone="accent-ink">
            {pending.competitionName}
          </Eyebrow>
          <SheetTitle className="font-display text-2xl">How did the competition go?</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 px-1 pb-8">
          {pending.athleteChoices.length > 0 && (
            <div className="space-y-2">
              <Eyebrow size="caption" weight="black" tone="secondary">
                Who is this about?
              </Eyebrow>
              <div className="flex flex-wrap gap-2">
                {pending.athleteChoices.map((a) => (
                  <Chip
                    key={a.id}
                    caseSensitive
                    selected={athleteId === a.id}
                    aria-pressed={athleteId === a.id}
                    onClick={() => setAthleteId(a.id)}
                  >
                    {a.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {coachList.length > 0 && (
            <div className="space-y-2">
              <Eyebrow size="caption" weight="black" tone="secondary">
                Send to
              </Eyebrow>
              <div className="flex flex-wrap gap-2">
                {coachList.map((c) => (
                  <Chip
                    key={c.id}
                    caseSensitive
                    tone="muted"
                    selected={coachIds.includes(c.id)}
                    aria-pressed={coachIds.includes(c.id)}
                    onClick={() => toggleCoach(c.id)}
                  >
                    {c.name}
                  </Chip>
                ))}
              </div>
              <p className="text-sm text-text-secondary">
                {coachIds.length === coachList.length
                  ? "Goes to every coach on the roster. Tap a coach to leave them out."
                  : `Goes to ${coachIds.length} of ${coachList.length} coaches.`}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Eyebrow as="label" htmlFor="competition-recap-body" size="caption" weight="black" tone="secondary">
              Your recap
            </Eyebrow>
            <p className="text-sm text-text-secondary">
              What went well? What didn&apos;t go well? Share any feedback.
            </p>
            <Textarea
              id="competition-recap-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={2000}
              placeholder="A few lines is plenty."
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
