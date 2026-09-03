import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import {
  dismissCompetitionRecap,
  getPendingCompetitionRecap,
} from "@/lib/competition-recap.functions";
import { useViewerRole } from "@/hooks/use-viewer-role";
import { CompetitionRecapSheet } from "./competition-recap-sheet";

/**
 * Shown to a parent or athlete who was at a competition (they opened the live
 * board there) once that competition has finished. Asks once, snoozes on
 * dismiss, and stops after the server's ask window closes.
 */
export function CompetitionRecapPrompt() {
  const qc = useQueryClient();
  const { role, isReady } = useViewerRole();
  const fetchPending = useServerFn(getPendingCompetitionRecap);
  const dismiss = useServerFn(dismissCompetitionRecap);
  const [open, setOpen] = useState(false);

  const enabled = isReady && (role === "parent" || role === "athlete");

  const { data: pending } = useQuery({
    queryKey: ["competition-recap-pending", role],
    queryFn: () => fetchPending(),
    enabled,
    staleTime: 5 * 60_000,
  });

  const clear = () => {
    void qc.invalidateQueries({ queryKey: ["competition-recap-pending"] });
  };

  const notNow = useMutation({
    mutationFn: (competitionId: string) => dismiss({ data: { competitionId } }),
    onSuccess: clear,
  });

  if (!enabled || !pending) return null;

  return (
    <>
      <div className="px-4 pt-4">
        <Card variant="section">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
              <Trophy className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-base leading-snug text-text-primary">
                How did {pending.competitionName} go?
              </p>
              <p className="mt-0.5 text-sm text-text-secondary">
                Share a quick recap with your coach.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Button type="button" size="sm" onClick={() => setOpen(true)}>
                  Write recap
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => notNow.mutate(pending.competitionId)}
                >
                  Not now
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <CompetitionRecapSheet
        pending={pending}
        open={open}
        onOpenChange={setOpen}
        onDone={clear}
      />
    </>
  );
}
