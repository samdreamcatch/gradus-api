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
        Three visual directions using the hand-drawn illustrations. Tap one to preview.
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
          label="Direction 1 — Cream card, illustration hero"
          onClick={() => setDirection("v1")}
        />
        <PreviewCard
          label="Direction 2 — Notebook page with highlighter"
          onClick={() => setDirection("v2")}
        />
        <PreviewCard
          label="Direction 3 — Full-bleed illustration band"
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

function useIllustration() {
  // Rotate through illustrations so the mockups feel varied.
  const idx = Math.floor(Math.random() * ILLUSTRATIONS.length);
  return ILLUSTRATIONS[idx];
}

function Headline({ variant }: { variant: Variant }) {
  return variant === "coach"
    ? "You're connected with Alex Rivera!"
    : "You're connected with Coach Jamie!";
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
// Cream paper card, centered illustration hero, serif headline, pen accent dot.

function DirectionOne({ variant }: { variant: Variant }) {
  const img = useIllustration();
  return (
    <div className="rounded-2xl bg-[#F5EFE1] p-6 shadow-2xl">
      <div className="relative mx-auto mb-4 flex h-40 items-center justify-center">
        <img
          src={img}
          alt=""
          className="max-h-40 w-auto object-contain"
        />
        <span className="absolute right-6 top-2 h-3 w-3 rounded-full bg-[--pen-tennis]" />
      </div>
      <DialogHeader className="items-center text-center">
        <DialogTitle className="font-display text-2xl font-black text-[#1F2937]">
          <Headline variant={variant} />
        </DialogTitle>
        <DialogDescription className="text-sm text-[#6B7280]">
          <Subhead variant={variant} />
        </DialogDescription>
      </DialogHeader>
      <div className="mt-5">
        <CTAButtons variant={variant} />
      </div>
      <button className="mt-3 w-full text-center text-xs font-medium text-[#9CA3AF]">
        Maybe later
      </button>
    </div>
  );
}

/* ------------------------------ Direction 2 -------------------------------- */
// White card with a highlighter swipe under the name and a small illustration
// tucked into the top-right corner like a notebook doodle.

function DirectionTwo({ variant }: { variant: Variant }) {
  const img = useIllustration();
  const name =
    variant === "coach" ? "Alex Rivera" : "Coach Jamie";
  return (
    <div className="relative overflow-hidden rounded-2xl bg-card p-6 shadow-2xl">
      <img
        src={img}
        alt=""
        className="absolute -right-4 -top-4 h-28 w-28 object-contain opacity-90"
      />
      <div className="mt-24">
        <p className="font-hand text-lg text-text-secondary">You're connected with</p>
        <h2 className="mt-1 font-display text-3xl font-black leading-tight text-text-primary">
          <span className="pen-highlight">{name}</span>
        </h2>
        <p className="mt-3 text-sm text-text-secondary">
          <Subhead variant={variant} />
        </p>
      </div>
      <div className="mt-5">
        <CTAButtons variant={variant} />
      </div>
      <button className="mt-3 w-full text-center text-xs font-medium text-text-tertiary">
        Maybe later
      </button>
    </div>
  );
}

/* ------------------------------ Direction 3 -------------------------------- */
// Illustration fills the top ~45% as a cream band; content sits on white below.

function DirectionThree({ variant }: { variant: Variant }) {
  const img = useIllustration();
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-2xl">
      <div className="relative flex h-48 items-center justify-center bg-[#F5EFE1]">
        <img src={img} alt="" className="max-h-40 w-auto object-contain" />
        <span className="absolute left-8 top-6 h-2 w-2 rounded-full bg-[--pen-orange]" />
        <span className="absolute right-10 bottom-8 h-2.5 w-2.5 rounded-full bg-[--pen-tennis]" />
      </div>
      <div className="p-6">
        <DialogHeader className="items-start text-left">
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
