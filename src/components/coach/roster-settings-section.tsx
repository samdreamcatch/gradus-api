import { useState } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, Pencil, Plus, Sparkles, Trash2, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";

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
import { SettingsDisclosure } from "@/components/settings/primitives";
import { type RosterAthlete, type RosterSlot } from "@/lib/coach-roster.functions";
import { rosterQueryOptions } from "@/lib/roster-queries";
import { deleteLessonSlot, removeAthleteFromRoster } from "@/lib/coach-roster-mutations.functions";
import { LessonSlotSheet, type LessonSlotSheetMode } from "@/components/coach/lesson-slot-sheet";
import { SettingsToggleRow } from "@/components/settings/primitives";
import { Switch } from "@/components/ui/switch";
import { SAMPLE_SPORT } from "@/data/sample-athlete";
import { useSampleAthleteDismissed } from "@/hooks/use-sample-athlete";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(minute: number): string {
  const h24 = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h24 >= 12 ? "p" : "a";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}


export function RosterSettingsSection() {
  const { data, isLoading } = useQuery(rosterQueryOptions);
  const [sheetMode, setSheetMode] = useState<LessonSlotSheetMode | null>(null);
  const athletes = data?.athletes ?? [];
  const { dismissed, dismiss, restore } = useSampleAthleteDismissed();
  const sampleAvailable = athletes.length === 0 && (data?.coachSports ?? []).includes(SAMPLE_SPORT);

  return (
    <>
      <SettingsDisclosure
        icon={<CalendarDays className="size-4" />}
        label="Roster & schedule"
        description="Add, edit, or remove recurring lessons; remove athletes."
        value={isLoading ? "" : `${athletes.length}`}
      >
        {athletes.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No athletes on your roster yet. Share your invite code to add some.
          </p>
        ) : (
          <ul className="divide-y divide-divider">
            {athletes.map((a) => (
              <AthleteRosterRow
                key={a.athleteId}
                athlete={a}
                onAddSlot={() =>
                  setSheetMode({
                    kind: "create",
                    athleteId: a.athleteId,
                    defaultDayOfWeek: 1,
                  })
                }
                onEditSlot={(s) =>
                  setSheetMode({
                    kind: "edit",
                    slotId: s.id,
                    athleteId: a.athleteId,
                    dayOfWeek: s.dayOfWeek,
                    startMinute: s.startMinute,
                    endMinute: s.endMinute,
                  })
                }
              />
            ))}
          </ul>
        )}
        {sampleAvailable ? (
          <div className="mt-3 border-t border-divider pt-1">
            <SettingsToggleRow
              icon={<Sparkles className="size-4" />}
              label="Sample athlete"
              description="Show Sample Athlete, a demo athlete, while your roster is empty."
              trailing={
                <Switch
                  checked={!dismissed}
                  onCheckedChange={(on) => (on ? restore() : dismiss())}
                  aria-label="Show sample athlete"
                />
              }
            />
          </div>
        ) : null}
      </SettingsDisclosure>

      <LessonSlotSheet
        open={sheetMode != null}
        onOpenChange={(o) => {
          if (!o) setSheetMode(null);
        }}
        mode={sheetMode}
        athletes={athletes}
      />
    </>
  );
}

function AthleteRosterRow({
  athlete,
  onAddSlot,
  onEditSlot,
}: {
  athlete: RosterAthlete;
  onAddSlot: () => void;
  onEditSlot: (slot: RosterSlot) => void;
}) {
  const qc = useQueryClient();
  const name = `${athlete.firstName} ${athlete.lastName}`.trim();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["coach", "roster"] });
    qc.invalidateQueries({ queryKey: ["coach", "roster", "practice-summaries"] });
  };

  const removeMutation = useMutation({
    mutationFn: () => removeAthleteFromRoster({ data: { athleteId: athlete.athleteId } }),
    onSuccess: () => {
      invalidate();
      toast.success(`${name} removed from roster`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteSlot = useMutation({
    mutationFn: (slotId: string) => deleteLessonSlot({ data: { slotId } }),
    onSuccess: () => {
      invalidate();
      toast.success("Recurring lesson deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-display text-base font-black text-text-primary">{name}</div>
          {athlete.sport ? (
            <div className="mt-0.5 text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
              {athlete.sport.replace(/_/g, " ")}
            </div>
          ) : null}
        </div>
        <Chip
          as="button"
          size="micro"
          weight="bold"
          tracking="widest"
          className="shrink-0 border-divider text-destructive hover:bg-elevated"
          onClick={() => setConfirmRemove(true)}
        >
          <UserMinus className="h-3 w-3" />
          Remove
        </Chip>
      </div>

      {athlete.slots.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {athlete.slots.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-divider bg-card px-3 py-2 text-sm"
            >
              <span className="tabular-nums text-text-primary">
                <span className="font-bold">{DAY_SHORT[s.dayOfWeek]}</span>{" "}
                <span className="text-text-secondary">
                  {formatTime(s.startMinute)}–{formatTime(s.endMinute)}
                </span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onEditSlot(s)}
                  aria-label="Edit lesson"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-elevated hover:text-text-primary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteSlot.mutate(s.id)}
                  aria-label="Delete lesson"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-destructive hover:bg-elevated"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-text-tertiary">No recurring lessons.</p>
      )}

      <div className="mt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onAddSlot}
          className="h-7 px-2 text-[11px] font-bold uppercase tracking-widest"
        >
          <Plus className="h-3 w-3" />
          Add lesson
        </Button>
      </div>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {name} from your roster?</AlertDialogTitle>
            <AlertDialogDescription>
              This unlinks the athlete from you. Their account and practice history stay intact.
              Their recurring lessons with you are unassigned and can be re-claimed later via your
              invite code.
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
    </li>
  );
}
