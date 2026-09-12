import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/utils";
import iconMark from "@/assets/icon-mark.png.asset.json";

/** The Gradus bar mark, on a paper chip so it reads in both themes. */
export function Mark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md bg-card",
        className,
      )}
    >
      <img src={iconMark.url} alt="" aria-hidden className="size-5" />
    </span>
  );
}

/**
 * Shared "thought bubble" shell: a small mark button that expands into an
 * anchored bubble with a tail. Used by the coach getting-started checklist and
 * the plans how-to helper. Positioning is left to the caller.
 */
export function HelpBubble({
  open,
  onOpen,
  onClose,
  title,
  meta,
  badge,
  openLabel,
  closeLabel,
  side = "bottom-right",
  children,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  title: string;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  openLabel: string;
  closeLabel: string;
  /** Where the bubble sits relative to the button. */
  side?: "bottom-right" | "top-left";
  children: React.ReactNode;
}) {
  const topLeft = side === "top-left";

  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onOpen}
      aria-label={openLabel}
      className={cn(
        "motion-safe:animate-scale-in relative size-14 bg-accent text-accent-foreground shadow-card",
        topLeft ? "rounded-2xl rounded-tl-md" : "rounded-2xl rounded-bl-md",
      )}
    >
      <Mark />
      {badge != null ? (
        <span
          className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-attention text-[10px] font-black text-attention-foreground shadow-card"
          aria-hidden
        >
          {badge}
        </span>
      ) : null}
    </Button>
  );

  const tail = (
    <div
      aria-hidden
      className={cn(
        "size-0",
        topLeft
          ? "ml-5 border-b-[12px] border-r-[14px] border-b-accent border-r-transparent"
          : "mr-5 ml-auto border-t-[12px] border-l-[14px] border-t-accent border-l-transparent",
      )}
    />
  );

  const bubble = (
    <div
      className={cn(
        "motion-safe:animate-scale-in w-80 max-w-full",
        topLeft ? "origin-top-left" : "origin-bottom-right",
      )}
    >
      {topLeft ? tail : null}
      <div className="overflow-hidden rounded-md border border-accent bg-accent shadow-card">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Mark />
            <Eyebrow as="h2" size="caption" className="text-accent-foreground">
              {title}
            </Eyebrow>
            {meta ? <span className="text-xs text-accent-foreground/80">{meta}</span> : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={closeLabel}
            onClick={onClose}
            className="-mr-2 shrink-0 text-accent-foreground"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="border-t border-accent/40 bg-card">{children}</div>
      </div>
      {topLeft ? null : tail}
    </div>
  );

  return open ? bubble : button;
}
