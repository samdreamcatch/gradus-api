import { useState } from "react";
import { MoreVertical, UserMinus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { RosterAthlete } from "@/lib/coach-roster.functions";
import { removeAthleteFromRoster } from "@/lib/coach-roster-mutations.functions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(minute: number): string {
  const h24 = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h24 >= 12 ? "p" : "a";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

export function RosterCard({
  athlete,
  onSelect,
}: {
  athlete: RosterAthlete;
  onSelect?: (athleteId: string) => void;
}) {
  const name = `${athlete.firstName} ${athlete.lastName}`.trim();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const qc = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: () =>
      removeAthleteFromRoster({ data: { athleteId: athlete.athleteId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coach", "roster"] });
      qc.invalidateQueries({ queryKey: ["coach", "roster", "practice-summaries"] });
      toast.success(`${name} removed from roster`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div
      className={cn(
        "group relative block w-full overflow-hidden rounded-2xl border border-divider bg-card p-4 pl-5 text-left shadow-card transition-all",
        "hover:-translate-y-0.5 hover:shadow-page",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5 bg-[var(--pen-tennis)]"
      />

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <button
          type="button"
          onClick={() => onSelect?.(athlete.athleteId)}
          className="min-w-0 truncate text-left font-display text-lg font-black leading-tight tracking-tight text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {name}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Athlete actions"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-tertiary transition hover:bg-elevated hover:text-text-primary"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setConfirmOpen(true);
              }}
              className="text-destructive focus:text-destructive"
            >
              <UserMinus className="mr-2 h-4 w-4" />
              Remove from roster
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-2">
        {athlete.slots.length === 0 ? (
          <span className="text-xs text-text-tertiary">No schedule</span>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {athlete.slots.map((s, i) => (
              <li
                key={i}
                className="rounded-pill border border-divider bg-elevated px-2 py-0.5 text-[11px] font-medium text-text-primary tabular-nums"
              >
                <span className="text-text-secondary">
                  {DAY_SHORT[s.dayOfWeek]}
                </span>{" "}
                <span>{formatTime(s.startMinute)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {name} from your roster?</AlertDialogTitle>
            <AlertDialogDescription>
              This unlinks the athlete from you. Their account, practice history,
              and parent stay intact. Their recurring lessons with you are unassigned
              and can be re-claimed later via your invite code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep on roster</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
