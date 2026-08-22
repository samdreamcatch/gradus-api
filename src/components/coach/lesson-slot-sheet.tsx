import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, Trash2, UserPlus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getSport, type SportKey } from "@/lib/coach-sports";
import { rosterQueryOptions } from "@/lib/roster-queries";
import type { RosterAthlete } from "@/lib/coach-roster.functions";
import {
  addAthleteWithGuardian,
  addLessonSlot,
  cancelLessonOccurrence,
  clearLessonOverride,
  deleteLessonSlot,
  linkExistingAthleteToRoster,
  rescheduleLessonOccurrence,
  updateLessonSlot,
} from "@/lib/coach-roster-mutations.functions";
import {
  matchScheduleRows,
  type MatchResult,
} from "@/lib/schedule-import.functions";

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
  const [addingAthlete, setAddingAthlete] = useState(false);

  useEffect(() => {
    if (!open) setAddingAthlete(false);
  }, [open]);

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

  if (mode.kind === "create" && addingAthlete) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="paper-surface max-h-[90dvh] overflow-y-auto">
          <SheetHeader className="text-left">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Back"
                onClick={() => setAddingAthlete(false)}
                className="-ml-2 shrink-0"
              >
                <ChevronLeft className="size-5" aria-hidden />
              </Button>
              <SheetTitle className="min-w-0 flex-1">New athlete</SheetTitle>
            </div>
          </SheetHeader>
          <div className="mt-4">
            <NewAthleteForm
              onCancel={() => setAddingAthlete(false)}
              onCreated={(id) => {
                setAthleteId(id);
                setAddingAthlete(false);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="paper-surface max-h-[90dvh] overflow-y-auto">
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
              <Select
                value={athleteId}
                onValueChange={(v) => {
                  if (v === "__new") {
                    setAddingAthlete(true);
                    return;
                  }
                  setAthleteId(v);
                }}
              >
                <SelectTrigger className="w-full bg-card">
                  <SelectValue placeholder="Pick an athlete" />
                </SelectTrigger>
                <SelectContent>
                  {athletes.map((a) => (
                    <SelectItem key={a.athleteId} value={a.athleteId}>
                      {a.firstName} {a.lastName}
                    </SelectItem>
                  ))}
                  <SelectItem value="__new">
                    <span className="flex items-center gap-2">
                      <UserPlus className="size-3.5" aria-hidden />
                      Add new athlete…
                    </span>
                  </SelectItem>
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
                    This removes the weekly lesson from every future date. One-off overrides on this
                    lesson are also removed.
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
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Inline "add new athlete" form — mirrors the schedule-import fields:
 * name, sport, and one invite email (parent/guardian, or the athlete's own).
 */
function NewAthleteForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (athleteId: string) => void;
}) {
  const qc = useQueryClient();
  const { data: roster } = useQuery(rosterQueryOptions);
  const coachSports = roster?.coachSports ?? [];

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [sport, setSport] = useState<string>(coachSports[0] ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const [match, setMatch] = useState<MatchResult | null>(null);

  useEffect(() => {
    if (!sport && coachSports.length > 0) setSport(coachSports[0]);
  }, [coachSports, sport]);

  const errors = {
    firstName: firstName.trim() ? null : "First name is required",
    lastName: lastName.trim() ? null : "Last name is required",
    guardianEmail: !guardianEmail.trim()
      ? "An email is required so we can send them an invite"
      : !/^\S+@\S+\.\S+$/.test(guardianEmail.trim())
        ? "Enter a valid email"
        : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

  const create = useMutation({
    mutationFn: () =>
      addAthleteWithGuardian({
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          guardianEmail: guardianEmail.trim() ? guardianEmail.trim() : undefined,
          sport: sport || undefined,
        },
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["coach", "roster"] });
      toast.success(
        res.guardianEmail
          ? `${firstName.trim()} added — invite sent to ${res.guardianEmail}`
          : `${firstName.trim()} added`,
      );
      onCreated(res.athleteId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const link = useMutation({
    mutationFn: (athleteId: string) =>
      linkExistingAthleteToRoster({ data: { athleteId, sport: sport || undefined } }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["coach", "roster"] });
      toast.success(
        res.alreadyOnRoster ? `${fullName} is already on your roster` : `${fullName} added`,
      );
      onCreated(res.athleteId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Step 1 → check whether this athlete already has a Gradus account.
  const lookup = useMutation({
    mutationFn: () =>
      matchScheduleRows({
        data: {
          athletes: [
            {
              key: "new-athlete",
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              guardianEmail: guardianEmail.trim(),
              athleteEmail: guardianEmail.trim(),
            },
          ],
        },
      }),
    onSuccess: (res) => {
      const result = res.results[0];
      if (!result || result.candidates.length === 0) {
        create.mutate();
        return;
      }
      setMatch(result);
    },
    onError: () => {
      // Matching is a convenience — never block adding the athlete.
      create.mutate();
    },
  });

  const field = (label: string, node: React.ReactNode, error: string | null) => (
    <div>
      <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
        {label}
      </label>
      {node}
      {showErrors && error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );

  const busy = lookup.isPending || create.isPending || link.isPending;

  // ---- Step 2: match review ----
  if (match) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          {match.status === "exact"
            ? "We found an existing Gradus account that looks like this athlete. Link it so they keep their history."
            : "These existing Gradus athletes look similar. Link one, or send a fresh invite."}
        </p>

        <div className="space-y-2">
          {match.candidates.map((c) => (
            <button
              key={c.athleteId}
              type="button"
              disabled={busy}
              onClick={() => link.mutate(c.athleteId)}
              className="press w-full rounded-md border border-divider bg-card p-3 text-left disabled:opacity-60"
            >
              <div className="text-sm font-semibold text-text-primary">{c.name}</div>
              <div className="mt-0.5 text-xs text-text-secondary">
                {[
                  c.maskedEmail,
                  c.guardianName ? `Guardian: ${c.guardianName}` : null,
                  c.onRoster ? "Already on your roster" : null,
                  c.reason === "email" ? "Email match" : "Name match",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </button>
          ))}
        </div>

        <div className="rounded-md border border-divider bg-card p-3">
          <div className="text-sm font-semibold text-text-primary">
            None of these — invite {fullName}
          </div>
          <p className="mt-0.5 text-xs text-text-secondary">
            We&apos;ll email {guardianEmail.trim()} a link to join Gradus.
          </p>
          <Button
            variant="secondary"
            className="mt-2 w-full"
            disabled={busy}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Sending…" : "Send invite"}
          </Button>
        </div>

        <SheetFooter className="mt-2 flex-row justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setMatch(null)}>
            Back
          </Button>
        </SheetFooter>
      </div>
    );
  }

  // ---- Step 1: details ----
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {field(
          "First name",
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />,
          errors.firstName,
        )}
        {field(
          "Last name",
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />,
          errors.lastName,
        )}
      </div>

      {coachSports.length > 0
        ? field(
            "Sport",
            <Select value={sport} onValueChange={setSport}>
              <SelectTrigger className="w-full bg-card">
                <SelectValue placeholder="Pick a sport" />
              </SelectTrigger>
              <SelectContent>
                {coachSports.map((s) => (
                  <SelectItem key={s} value={s}>
                    {getSport(s as SportKey)?.label ?? s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>,
            null,
          )
        : null}

      {field(
        "EMAIL",
        <Input
          type="email"
          inputMode="email"
          value={guardianEmail}
          onChange={(e) => setGuardianEmail(e.target.value)}
          placeholder="parent@example.com"
        />,
        errors.guardianEmail,
      )}

      <p className="text-xs text-text-secondary">
        Enter a parent/guardian email for athletes under 18
      </p>

      <SheetFooter className="mt-2 flex-row justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            setShowErrors(true);
            if (hasErrors) return;
            lookup.mutate();
          }}
          disabled={busy}
        >
          {busy ? "Checking…" : "Add athlete"}
        </Button>
      </SheetFooter>
    </div>
  );
}
