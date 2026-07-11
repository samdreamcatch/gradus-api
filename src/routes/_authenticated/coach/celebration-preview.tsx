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

import snowboarder from "@/assets/celebration/snowboarder.png.asset.json";
import polevaulter from "@/assets/celebration/polevaulter.png.asset.json";
import jockey from "@/assets/celebration/jockey.png.asset.json";
import ballerina from "@/assets/celebration/ballerina.png.asset.json";
import wave from "@/assets/celebration/wave.png.asset.json";

export const Route = createFileRoute("/_authenticated/coach/celebration-preview")({
  component: CelebrationPreview,
});

type Variant = "coach" | "parent" | "athlete";
type Direction = "v1" | "v2" | "v3";

const ILLUSTRATIONS = [
  snowboarder.url,
  polevaulter.url,
  jockey.url,
  ballerina.url,
  wave.url,
];

function CelebrationPreview() {
  const [variant, setVariant] = useState<Variant>("coach");
  const [direction, setDirection] = useState<Direction | null>(null);

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="font-display text-2xl font-black text-text-primary">
        Celebration mockups
      </h1>
      <p className="text-sm text-text-secondary">
        Three tiled-pattern directions. Copy is unchanged — imagery varies.
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
          label="Direction 1 — Pattern wallpaper"
          onClick={() => setDirection("v1")}
        />
        <PreviewCard
          label="Direction 2 — Pattern header band"
          onClick={() => setDirection("v2")}
        />
        <PreviewCard
          label="Direction 3 — Subtle pattern + highlighter pill"
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

/* ------------------------------ Shared helpers ----------------------------- */

/**
 * Deterministic tiled grid of the 5 illustrations. Density controls tile size
 * and opacity controls how much the pattern reads through the surface.
 */
function IllustrationTile({
  density = 5,
  opacity = 0.14,
  rows = 6,
}: {
  density?: number;
  opacity?: number;
  rows?: number;
}) {
  const cells = Array.from({ length: density * rows });
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 grid"
      style={{
        gridTemplateColumns: `repeat(${density}, minmax(0, 1fr))`,
        gridAutoRows: `${100 / rows}%`,
        opacity,
      }}
    >
      {cells.map((_, i) => {
        const img = ILLUSTRATIONS[(i * 3 + Math.floor(i / density)) % ILLUSTRATIONS.length];
        const rotate = ((i * 37) % 30) - 15;
        return (
          <div key={i} className="flex items-center justify-center p-1.5">
            <img
              src={img}
              alt=""
              className="max-h-full max-w-full object-contain mix-blend-multiply"
              style={{ transform: `rotate(${rotate}deg)` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function CoachName({ variant }: { variant: Variant }) {
  return variant === "coach" ? "Alex Rivera" : "Coach Jamie";
}

function Headline({ variant }: { variant: Variant }) {
  return variant === "coach"
    ? `You're connected with ${CoachName({ variant })}!`
    : `You're connected with ${CoachName({ variant })}!`;
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
// Full-modal tiled illustration wallpaper, serif headline, pen highlight
// under the coach name.

function DirectionOne({ variant }: { variant: Variant }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-card p-6 shadow-2xl">
      <IllustrationTile density={5} rows={7} opacity={0.12} />
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
// Dense illustration pattern in top ~40% band, clean paper below for content.

function DirectionTwo({ variant }: { variant: Variant }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-2xl">
      <div className="relative h-40 overflow-hidden border-b border-divider bg-elevated">
        <IllustrationTile density={5} rows={3} opacity={0.55} />
        {/* Jelly-pen highlighter sweep across the band */}
        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 h-6 w-40 -translate-x-1/2 -translate-y-1/2 -rotate-3 rounded-full"
          style={{ background: "var(--pen-tennis)", opacity: 0.75 }}
        />
      </div>
      <div className="p-6">
        <DialogHeader className="items-center text-center">
          <DialogTitle className="font-display text-2xl font-black text-text-primary">
            <Headline variant={variant} />
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
// Very subtle pattern wash, headline phrase wrapped in a jelly-pen
// highlighter pill (like "Try Gradus" on the reference card).

function DirectionThree({ variant }: { variant: Variant }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-card p-6 shadow-2xl">
      <IllustrationTile density={6} rows={8} opacity={0.06} />
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
