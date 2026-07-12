import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { RosterAthlete } from "@/lib/coach-roster.functions";
import {
  addLessonSlot,
  cancelLessonOccurrence,
  clearLessonOverride,
  deleteLessonSlot,
  rescheduleLessonOccurrence,
  updateLessonSlot,
} from "@/lib/coach-roster-mutations.functions";

const DAYS = [
  { value: 1, short: "Mon" },
  { value: 2, short: "Tue" },
  { value: 3, short: "Wed" },
  { value: 4, short: "Thu" },
  { value: 5, short: "Fri" },
  { value: 6, short: "Sat" },
  { value: 0, short: "Sun" },
];

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 24 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

export type LessonSlotSheetMode =
  | { kind: "create"; athleteId?: string; defaultDayOfWeek?: number }
  | {
      kind: "edit";
      slotId: string;
      athleteId: string;
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
    }
  | {
      kind: "occurrence";
      slotId: string;
      athleteId: string;
      date: string; // YYYY-MM-DD
      dayOfWeek: number;
      startMinute: number; // current effective times (after override if any)
      endMinute: number;
      hasOverride: boolean;
    };

export function LessonSlotSheet({
  open,
  onOpenChange,
  mode,
  athletes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: LessonSlotSheetMode | null;
  athletes: RosterAthlete[];
}) {
  const qc = useQueryClient();
  const [athleteId, setAthleteId] = useState<string>("");
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [startStr, setStartStr] = useState<string>("16:00");
  const [endStr, setEndStr] = useState<string>("17:00");

  useEffect(() => {
    if (!open || !mode) return;
    if (mode.kind === "create") {
      setAthleteId(mode.athleteId ?? athletes[0]?.athleteId ?? "");
      setDayOfWeek(mode.defaultDayOfWeek ?? 1);
      setStartStr("16:00");
      setEndStr("17:00");
    } else {
      setAthleteId(mode.athleteId);
      setDayOfWeek(mode.dayOfWeek);
      setStartStr(minutesToHHMM(mode.startMinute));
      setEndStr(minutesToHHMM(mode.endMinute));
    }
  }, [open, mode, athletes]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["coach", "roster"] });
    qc.invalidateQueries({ queryKey: ["coach", "roster", "practice-summaries"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!mode) throw new Error("No mode");
      const startMinute = hhmmToMinutes(startStr);
      const endMinute = hhmmToMinutes(endStr);
      if (startMinute == null || endMinute == null) throw new Error("Invalid time");
      if (startMinute >= endMinute) throw new Error("Start must be before end");
      if (mode.kind === "create") {
        if (!athleteId) throw new Error("Pick an athlete");
        return addLessonSlot({
          data: { athleteId, dayOfWeek, startMinute, endMinute },
        });
      }
      if (mode.kind === "edit") {
        return updateLessonSlot({
          data: { slotId: mode.slotId, dayOfWeek, startMinute, endMinute },
        });
      }
      return rescheduleLessonOccurrence({
        data: { slotId: mode.slotId, date: mode.date, startMinute, endMinute },
      });
    },
    onSuccess: () => {
      invalidate();
      toast.success(
        mode?.kind === "create"
          ? "Lesson added"
          : mode?.kind === "edit"
            ? "Lesson updated"
            : "This date rescheduled",
      );
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (mode?.kind !== "edit") throw new Error("Invalid mode");
      return deleteLessonSlot({ data: { slotId: mode.slotId } });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Recurring lesson deleted");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelDateMutation = useMutation({
    mutationFn: async () => {
      if (mode?.kind !== "occurrence") throw new Error("Invalid mode");
      return cancelLessonOccurrence({
        data: { slotId: mode.slotId, date: mode.date },
      });
    },
    onSuccess: () => {
      invalidate();
      toast.success("This date canceled");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearOverrideMutation = useMutation({
    mutationFn: async () => {
      if (mode?.kind !== "occurrence") throw new Error("Invalid mode");
      return clearLessonOverride({
        data: { slotId: mode.slotId, date: mode.date },
      });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Override removed");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!mode) return null;

  const title =
    mode.kind === "create"
      ? "Add lesson"
      : mode.kind === "edit"
        ? "Edit recurring lesson"
        : "Reschedule this date";
  const description =
    mode.kind === "occurrence"
      ? `Affects ${mode.date} only — other weeks stay on the regular schedule.`
      : "Recurring weekly lesson.";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto bg-popover"
      >
        <SheetHeader className="text-left">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Athlete */}
          {mode.kind === "create" ? (
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                Athlete
              </label>
              <Select value={athleteId} onValueChange={setAthleteId}>
                <SelectTrigger className="w-full bg-card">
                  <SelectValue placeholder="Pick an athlete" />
                </SelectTrigger>
                <SelectContent>
                  {athletes.map((a) => (
                    <SelectItem key={a.athleteId} value={a.athleteId}>
                      {a.firstName} {a.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {/* Day of week (locked for occurrence mode) */}
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
              Day
            </label>
            {mode.kind === "occurrence" ? (
              <div className="rounded-md border border-divider bg-card px-3 py-2 text-sm text-text-secondary">
                {DAYS.find((d) => d.value === mode.dayOfWeek)?.short} · {mode.date}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {DAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDayOfWeek(d.value)}
                    className={cn(
                      "rounded-md border px-1 py-2 text-[11px] font-bold uppercase tracking-wider transition",
                      dayOfWeek === d.value
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-divider bg-card text-text-secondary hover:border-accent/40",
                    )}
                  >
                    {d.short}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                Start
              </label>
              <input
                type="time"
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
                className="w-full rounded-md border border-divider bg-card px-3 py-2 text-sm text-text-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                End
              </label>
              <input
                type="time"
                value={endStr}
                onChange={(e) => setEndStr(e.target.value)}
                className="w-full rounded-md border border-divider bg-card px-3 py-2 text-sm text-text-primary"
              />
            </div>
          </div>

          {/* Mode-specific destructive actions */}
          {mode.kind === "edit" ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-destructive hover:underline"
                >
                  <Trash2 className="size-3.5" />
                  Delete recurring lesson
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this recurring lesson?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the weekly lesson from every future date. One-off
                    overrides on this lesson are also removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}

          {mode.kind === "occurrence" ? (
            <div className="flex flex-wrap gap-3 text-xs font-bold uppercase tracking-widest">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button type="button" className="text-destructive hover:underline">
                    Cancel this date
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel just this date?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The recurring lesson stays in place for other weeks.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => cancelDateMutation.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Cancel date
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {mode.hasOverride ? (
                <button
                  type="button"
                  onClick={() => clearOverrideMutation.mutate()}
                  className="text-text-secondary hover:underline"
                >
                  Undo override
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <SheetFooter className="mt-6 flex-row justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
