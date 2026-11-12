import { useId } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const note = "Weeks run Monday to Sunday, UTC";
export function ClubWeekStepper({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) {
  const id = useId();
  const start = new Date(`${value}T00:00:00Z`);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  const format = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const label = `${format(start)}–${start.getUTCMonth() === end.getUTCMonth() ? end.getUTCDate() : format(end)}`;
  const step = (days: number) => { const date = new Date(start); date.setUTCDate(date.getUTCDate() + days); onValueChange(date.toISOString().slice(0, 10)); };
  return <div className="inline-flex h-11 shrink-0 items-center rounded-full border border-border-strong font-sans" title={note} aria-describedby={id}>
    <Button variant="ghost" size="icon" className="min-h-11 min-w-11 rounded-full press-soft" aria-label="Previous week" onClick={() => step(-7)}><ChevronLeft className="size-4" /></Button>
    <span className="min-w-24 text-center text-sm text-text-primary" aria-label="Period">{label}</span>
    <Button variant="ghost" size="icon" className="min-h-11 min-w-11 rounded-full press-soft" aria-label="Next week" onClick={() => step(7)}><ChevronRight className="size-4" /></Button>
    <span id={id} className="sr-only">{note}</span>
  </div>;
}