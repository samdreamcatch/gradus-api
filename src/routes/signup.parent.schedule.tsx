import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listAthletesForCode,
  saveAthleteSchedule,
} from "@/lib/parent-signup.functions";

const searchSchema = z.object({
  code: z.string().trim().toUpperCase().length(8).regex(/^[A-Z2-9]+$/),
});

export const Route = createFileRoute("/signup/parent/schedule")({
  validateSearch: (s) => searchSchema.parse(s),
  component: ParentSchedulePage,
});

const DAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

// 15-min increments from 6:00 AM (360) to 9:45 PM (1305)
const TIME_OPTIONS: { value: number; label: string }[] = [];
for (let m = 360; m <= 1305; m += 15) {
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  TIME_OPTIONS.push({
    value: m,
    label: `${h12}:${String(min).padStart(2, "0")} ${ampm}`,
  });
}

type Slot = { dayOfWeek: number | null; startMinute: number | null; endMinute: number | null };

function ParentSchedulePage() {
  const { code } = Route.useSearch();
  const navigate = useNavigate();
  const fetchAthletes = useServerFn(listAthletesForCode);
  const save = useServerFn(saveAthleteSchedule);

  const { data, isLoading, error } = useQuery({
    queryKey: ["athletes-for-code", code],
    queryFn: () => fetchAthletes({ data: { code } }),
  });

  const [index, setIndex] = useState(0);
  const [byAthlete, setByAthlete] = useState<Record<string, Slot[]>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const athletes = data?.athletes ?? [];
  const current = athletes[index];
  const slots: Slot[] = byAthlete[current?.id ?? ""] ?? [
    { dayOfWeek: null, startMinute: null, endMinute: null },
  ];

  const setSlots = (next: Slot[]) => {
    if (!current) return;
    setByAthlete((p) => ({ ...p, [current.id]: next }));
  };
  const updateSlot = (i: number, patch: Partial<Slot>) =>
    setSlots(slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addSlot = () =>
    setSlots([...slots, { dayOfWeek: null, startMinute: null, endMinute: null }]);
  const removeSlot = (i: number) =>
    setSlots(slots.length === 1 ? slots : slots.filter((_, idx) => idx !== i));

  const finish = async (skip: boolean) => {
    if (!current) return;
    setFormError(null);

    const cleaned = skip
      ? []
      : slots
          .filter(
            (s): s is { dayOfWeek: number; startMinute: number; endMinute: number } =>
              s.dayOfWeek !== null && s.startMinute !== null && s.endMinute !== null,
          )
          .map((s) => ({
            dayOfWeek: s.dayOfWeek,
            startMinute: s.startMinute,
            endMinute: s.endMinute,
          }));

    for (const s of cleaned) {
      if (s.endMinute <= s.startMinute) {
        setFormError("End time must be after start time for every slot.");
        return;
      }
    }

    setSaving(true);
    try {
      await save({ data: { code, athleteId: current.id, slots: cleaned } });
      if (index + 1 < athletes.length) {
        setIndex(index + 1);
      } else {
        navigate({ to: "/parent" });
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-xl rounded-2xl bg-card p-8 shadow-card sm:p-10">
        {isLoading ? (
          <p className="text-text-tertiary">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : !current ? (
          <p className="text-text-tertiary">No athletes found.</p>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
                Athlete {index + 1} of {athletes.length}
              </p>
              <div className="flex gap-1.5">
                {athletes.map((_, n) => (
                  <span
                    key={n}
                    className={`h-1.5 w-6 rounded-full ${n <= index ? "bg-accent" : "bg-divider"}`}
                  />
                ))}
              </div>
            </div>

            <h1 className="font-display text-3xl text-text-primary sm:text-4xl">
              {current.firstName}&apos;s lesson times
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              When does {current.firstName} see their coach each week? We&apos;ll use
              this to recommend a practice schedule around lessons.
            </p>

            <div className="mt-8 space-y-3">
              {slots.map((slot, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-end gap-2 rounded-md border border-divider bg-elevated p-3"
                >
                  <div className="min-w-[140px] flex-1 space-y-1">
                    <Label className="text-xs text-text-tertiary">Day</Label>
                    <Select
                      value={slot.dayOfWeek === null ? "" : String(slot.dayOfWeek)}
                      onValueChange={(v) => updateSlot(i, { dayOfWeek: Number(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Day" />
                      </SelectTrigger>
                      <SelectContent>
                        {DAYS.map((d) => (
                          <SelectItem key={d.value} value={String(d.value)}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-[110px] flex-1 space-y-1">
                    <Label className="text-xs text-text-tertiary">Start</Label>
                    <Select
                      value={slot.startMinute === null ? "" : String(slot.startMinute)}
                      onValueChange={(v) => updateSlot(i, { startMinute: Number(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Start" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[260px]">
                        {TIME_OPTIONS.map((t) => (
                          <SelectItem key={t.value} value={String(t.value)}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-[110px] flex-1 space-y-1">
                    <Label className="text-xs text-text-tertiary">End</Label>
                    <Select
                      value={slot.endMinute === null ? "" : String(slot.endMinute)}
                      onValueChange={(v) => updateSlot(i, { endMinute: Number(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="End" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[260px]">
                        {TIME_OPTIONS.map((t) => (
                          <SelectItem key={t.value} value={String(t.value)}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {slots.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSlot(i)}
                      aria-label={`Remove slot ${i + 1}`}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addSlot}
                className="text-accent-ink"
              >
                <Plus className="size-4" /> Add another time
              </Button>
            </div>

            {formError && <p className="mt-4 text-sm text-destructive">{formError}</p>}

            <div className="mt-10 flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={() => finish(true)}
                disabled={saving}
              >
                Skip for now
              </Button>
              <Button onClick={() => finish(false)} disabled={saving}>
                {saving
                  ? "Saving…"
                  : index + 1 < athletes.length
                    ? "Save & next athlete"
                    : "Finish"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
