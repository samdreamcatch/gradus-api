import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PartyPopper, MessageCircle, CalendarDays, ClipboardList } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/coach/celebration-preview")({
  component: CelebrationPreview,
});

type Variant = "coach" | "parent" | "athlete";

function CelebrationPreview() {
  const [variant, setVariant] = useState<Variant>("coach");
  const [open, setOpen] = useState(true);
  const [key, setKey] = useState(0);

  const replay = (v: Variant) => {
    setVariant(v);
    setOpen(false);
    setTimeout(() => {
      setKey((k) => k + 1);
      setOpen(true);
    }, 50);
  };

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="font-display text-2xl font-black text-text-primary">
        Celebration preview
      </h1>
      <p className="text-sm text-text-secondary">
        Preview-only — not wired to real data. Pick a role to replay.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant={variant === "coach" ? "default" : "outline"} onClick={() => replay("coach")}>
          Coach
        </Button>
        <Button variant={variant === "parent" ? "default" : "outline"} onClick={() => replay("parent")}>
          Parent
        </Button>
        <Button variant={variant === "athlete" ? "default" : "outline"} onClick={() => replay("athlete")}>
          Adult athlete
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm overflow-hidden">
          <ConfettiBurst key={key} />
          <DialogHeader className="items-center text-center">
            <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
              <PartyPopper className="h-7 w-7" aria-hidden />
            </div>
            <DialogTitle className="font-display text-2xl font-black text-text-primary">
              {variant === "coach"
                ? "You're connected with Alex Rivera!"
                : "You're connected with Coach Jamie!"}
            </DialogTitle>
            <DialogDescription className="text-sm text-text-secondary">
              {variant === "coach"
                ? "Take a moment to get set up — pick a next step below."
                : "Say hi so they know you're here."}
            </DialogDescription>
          </DialogHeader>

          {variant === "coach" ? (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-auto flex-col gap-1 py-3">
                <CalendarDays className="h-5 w-5" aria-hidden />
                <span className="text-xs font-bold">View schedule</span>
              </Button>
              <Button type="button" className="h-auto flex-col gap-1 py-3">
                <ClipboardList className="h-5 w-5" aria-hidden />
                <span className="text-xs font-bold">Assign first plan</span>
              </Button>
            </div>
          ) : (
            <div className="mt-4">
              <Button type="button" className="w-full gap-2">
                <MessageCircle className="h-4 w-4" aria-hidden />
                Say hello
              </Button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 w-full text-center text-xs font-medium text-text-tertiary hover:text-text-secondary"
          >
            Maybe later
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfettiBurst() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.2,
        duration: 1.2 + Math.random() * 0.9,
        rotate: Math.random() * 360,
        color: [
          "var(--pen-tennis)",
          "var(--pen-pool)",
          "var(--pen-iris)",
          "var(--pen-pink)",
          "var(--pen-orange)",
        ][i % 5],
      })),
    [],
  );
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-40 overflow-hidden"
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
          className="absolute top-0 h-2 w-1.5 rounded-[1px] animate-[celebration-fall_linear_forwards]"
        />
      ))}
    </div>
  );
}
