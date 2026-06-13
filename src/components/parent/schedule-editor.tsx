import { Plus, X, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type Frequency = "weekly" | "biweekly" | "twice_monthly" | "monthly";

export type Slot = {
  dayOfWeek: number | null;
  startMinute: number | null;
  endMinute: number | null;
  frequency: Frequency;
  weeksOfMonth: number[];
  startsOn: Date | null;
};

const DAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every other week" },
  { value: "twice_monthly", label: "2x per month" },
  { value: "monthly", label: "1x per month" },
];

const WEEK_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: 5, label: "Last" },
];

export const TIME_OPTIONS: { value: number; label: string }[] = (() => {
  const out: { value: number; label: string }[] = [];
  for (let m = 360; m <= 1305; m += 15) {
    const h24 = Math.floor(m / 60);
    const min = m % 60;
    const ampm = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    out.push({ value: m, label: `${h12}:${String(min).padStart(2, "0")} ${ampm}` });
  }
  return out;
})();

export function emptySlot(): Slot {
  return {
    dayOfWeek: null,
    startMinute: null,
    endMinute: null,
    frequency: "weekly",
    weeksOfMonth: [],
    startsOn: null,
  };
}

export function weeksRequired(f: Frequency): number {
  if (f === "twice_monthly") return 2;
  if (f === "monthly") return 1;
  return 0;
}
function weeksHelpText(f: Frequency): string {
  if (f === "twice_monthly") return "Pick the 2 weeks of the month for this lesson.";
  if (f === "monthly") return "Pick the week of the month for this lesson.";
  return "";
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface ScheduleEditorProps {
  slots: Slot[];
  onChange: (slots: Slot[]) => void;
}

export function ScheduleEditor({ slots, onChange }: ScheduleEditorProps) {
  const updateSlot = (i: number, patch: Partial<Slot>) =>
    onChange(slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addSlot = () => onChange([...slots, emptySlot()]);
  const removeSlot = (i: number) =>
    onChange(slots.length === 1 ? slots : slots.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      {slots.map((slot, i) => (
        <div
          key={i}
          className="grid grid-cols-2 gap-3 rounded-xl border border-divider bg-elevated p-4 sm:flex sm:flex-wrap sm:items-end"
        >
          <div className="col-span-2 space-y-1 sm:min-w-[140px] sm:flex-1">
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
          <div className="space-y-1 sm:min-w-[110px] sm:flex-1">
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
          <div className="space-y-1 sm:min-w-[110px] sm:flex-1">
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
          <div className="col-span-2 space-y-1 sm:min-w-[150px] sm:flex-1">
            <Label className="text-xs text-text-tertiary">Frequency</Label>
            <Select
              value={slot.frequency}
              onValueChange={(v) => {
                const f = v as Frequency;
                updateSlot(i, { frequency: f, weeksOfMonth: [], startsOn: null });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Frequency" />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
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
          {slot.frequency === "biweekly" && (
            <div className="col-span-2 space-y-1.5 sm:basis-full">
              <Label className="text-xs text-text-tertiary">
                Starting from — the lesson repeats every 2 weeks from this date.
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !slot.startsOn && "text-text-tertiary",
                    )}
                  >
                    <CalendarIcon className="mr-2 size-4" />
                    {slot.startsOn ? format(slot.startsOn, "EEE, MMM d, yyyy") : "Pick a start date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={slot.startsOn ?? undefined}
                    onSelect={(d) => updateSlot(i, { startsOn: d ?? null })}
                    disabled={
                      slot.dayOfWeek !== null
                        ? (date) => date.getDay() !== slot.dayOfWeek
                        : undefined
                    }
                    autoFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}
          {(slot.frequency === "twice_monthly" || slot.frequency === "monthly") && (
            <div className="col-span-2 space-y-1.5 sm:basis-full">
              <Label className="text-xs text-text-tertiary">{weeksHelpText(slot.frequency)}</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEK_OPTIONS.map((w) => {
                  const selected = slot.weeksOfMonth.includes(w.value);
                  const max = weeksRequired(slot.frequency);
                  const toggle = () => {
                    if (selected) {
                      updateSlot(i, {
                        weeksOfMonth: slot.weeksOfMonth.filter((x) => x !== w.value),
                      });
                    } else {
                      const next =
                        slot.weeksOfMonth.length >= max
                          ? [...slot.weeksOfMonth.slice(1), w.value]
                          : [...slot.weeksOfMonth, w.value];
                      updateSlot(i, { weeksOfMonth: next });
                    }
                  };
                  return (
                    <button
                      key={w.value}
                      type="button"
                      onClick={toggle}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? "border-accent bg-accent text-accent-foreground"
                          : "border-divider bg-card text-text-secondary hover:border-accent/50"
                      }`}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>
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
  );
}

/** Validate slots for save; returns an error message or null. */
export function validateSlots(slots: Slot[]): string | null {
  for (const s of slots) {
    if (s.dayOfWeek === null || s.startMinute === null || s.endMinute === null) {
      return "Fill in day, start, and end time for every slot.";
    }
    if (s.endMinute <= s.startMinute) return "End time must be after start time for every slot.";
    const need = weeksRequired(s.frequency);
    if (need > 0 && s.weeksOfMonth.length !== need) {
      return need === 1
        ? "Pick which week of the month for every monthly lesson."
        : "Pick 2 weeks of the month for every 2x-monthly lesson.";
    }
    if (s.frequency === "biweekly" && !s.startsOn) {
      return "Pick a starting date for every every-other-week lesson.";
    }
  }
  return null;
}
