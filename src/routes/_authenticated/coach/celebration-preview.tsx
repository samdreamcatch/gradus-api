import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MessageCircle, CalendarDays, ClipboardList } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import poster from "@/assets/celebration/sports-poster.png.asset.json";

export const Route = createFileRoute("/_authenticated/coach/celebration-preview")({
  component: CelebrationPreview,
});

type Variant = "coach" | "parent" | "athlete";
type Direction = "v1" | "v2" | "v3";

function CelebrationPreview() {
  const [variant, setVariant] = useState<Variant>("coach");
  const [direction, setDirection] = useState<Direction | null>(null);

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="font-display text-2xl font-black text-text-primary">
        Celebration mockups
      </h1>
      <p className="text-sm text-text-secondary">
        Three directions using the sports poster art directly, like the business card.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={variant === "coach" ? "default" : "outline"}
          onClick={() => setVariant("coach")}
        >
          Coach
        </Button>
        <Button
          size="sm"
          variant={variant === "parent" ? "default" : "outline"}
          onClick={() => setVariant("parent")}
        >
          Parent / Athlete
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <PreviewCard
          label="Direction 1 — Poster wallpaper wash"
          onClick={() => setDirection("v1")}
        />
        <PreviewCard
          label="Direction 2 — Poster header band"
          onClick={() => setDirection("v2")}
        />
        <PreviewCard
          label="Direction 3 — Poster wash + highlighter pill"
          onClick={() => setDirection("v3")}
        />
      </div>

      <Dialog open={!!direction} onOpenChange={(o) => !o && setDirection(null)}>
        <DialogContent className="max-w-sm overflow-hidden border-0 bg-transparent p-0 shadow-none">
          {direction === "v1" && <DirectionOne variant={variant} />}
          {direction === "v2" && <DirectionTwo variant={variant} />}
          {direction === "v3" && <DirectionThree variant={variant} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PreviewCard({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-divider bg-card px-4 py-3 text-left text-sm font-medium text-text-primary hover:bg-elevated"
    >
      {label}
    </button>
  );
}

/* -------------------------- Shared poster background ----------------------- */

/**
 * The full sports poster PNG as a repeating wallpaper. `tile` sets the tile
 * width; the poster repeats horizontally and vertically. `opacity` controls
 * how much of the paper surface reads through.
 */
function PosterBg({
  opacity = 0.18,
  tile = 320,
  mode = "tile",
}: {
  opacity?: number;
  tile?: number;
  mode?: "tile" | "cover";
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `url(${poster.url})`,
        backgroundSize: mode === "cover" ? "cover" : `${tile}px auto`,
        backgroundPosition: mode === "cover" ? "center" : "top left",
        backgroundRepeat: mode === "cover" ? "no-repeat" : "repeat",
        opacity,
        mixBlendMode: "multiply",
      }}
    />
  );
}

function CoachName({ variant }: { variant: Variant }) {
  return variant === "coach" ? "Alex Rivera" : "Coach Jamie";
}

function Subhead({ variant }: { variant: Variant }) {
  return variant === "coach"
    ? "Take a moment to get set up — pick a next step below."
    : "Say hi so they know you're here.";
}

function CTAButtons({ variant }: { variant: Variant }) {
  if (variant === "coach") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-auto flex-col gap-1 py-3">
          <CalendarDays className="h-5 w-5" aria-hidden />
          <span className="text-xs font-bold">View schedule</span>
        </Button>
        <Button className="h-auto flex-col gap-1 py-3">
          <ClipboardList className="h-5 w-5" aria-hidden />
          <span className="text-xs font-bold">Assign first plan</span>
        </Button>
      </div>
    );
  }
  return (
    <Button className="w-full gap-2">
      <MessageCircle className="h-4 w-4" aria-hidden />
      Say hello
    </Button>
  );
}

/* ------------------------------ Direction 1 -------------------------------- */
// Poster art as a faint wallpaper across the whole modal, content on top.

function DirectionOne({ variant }: { variant: Variant }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-card p-6 shadow-2xl">
      <PosterBg opacity={0.22} tile={260} mode="tile" />
      <div className="relative">
        <DialogHeader className="items-center text-center">
          <DialogTitle className="font-display text-2xl font-black text-text-primary">
            You're connected with{" "}
            <span className="pen-highlight">
              <CoachName variant={variant} />
            </span>
            !
          </DialogTitle>
          <DialogDescription className="text-sm text-text-secondary">
            <Subhead variant={variant} />
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5">
          <CTAButtons variant={variant} />
        </div>
        <button className="mt-3 w-full text-center text-xs font-medium text-text-tertiary">
          Maybe later
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ Direction 2 -------------------------------- */
// Full-color poster art in a top band, clean paper below (like card front→back).

function DirectionTwo({ variant }: { variant: Variant }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-popover shadow-2xl">
      <div
        className="relative h-44 border-b border-divider bg-white"
        style={{
          backgroundImage: `url(${poster.url})`,
          backgroundSize: "cover",
          backgroundPosition: "center 30%",
        }}
        aria-hidden
      />
      <div className="p-6">
        <DialogHeader className="items-center text-center">
          <DialogTitle className="font-display text-2xl font-black text-text-primary">
            You're connected with <CoachName variant={variant} />!
          </DialogTitle>
          <DialogDescription className="text-sm text-text-secondary">
            <Subhead variant={variant} />
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5">
          <CTAButtons variant={variant} />
        </div>
        <button className="mt-3 w-full text-center text-xs font-medium text-text-tertiary">
          Maybe later
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ Direction 3 -------------------------------- */
// Very subtle poster wash, key phrase wrapped in a jelly-pen highlighter pill
// exactly like "Try Gradus" on the business card back.

function DirectionThree({ variant }: { variant: Variant }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-card p-6 shadow-2xl">
      <PosterBg opacity={0.12} tile={220} mode="tile" />
      <div className="relative">
        <DialogHeader className="items-center text-center">
          <DialogTitle className="font-display text-2xl font-black leading-tight text-text-primary">
            <span className="relative inline-block">
              <span
                aria-hidden
                className="absolute inset-x-[-10px] inset-y-[2px] -rotate-1 rounded-full"
                style={{ background: "var(--pen-tennis)", opacity: 0.85 }}
              />
              <span className="relative">You're connected!</span>
            </span>
            <div className="mt-2 text-xl font-black text-text-primary">
              with <CoachName variant={variant} />
            </div>
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-text-secondary">
            <Subhead variant={variant} />
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5">
          <CTAButtons variant={variant} />
        </div>
        <button className="mt-3 w-full text-center text-xs font-medium text-text-tertiary">
          Maybe later
        </button>
      </div>
    </div>
  );
}
