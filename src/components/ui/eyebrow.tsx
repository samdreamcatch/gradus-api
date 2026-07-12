import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Eyebrow — small uppercase label used as a section marker or chip caption.
 *
 * Three sizes cover every eyebrow role in the app. Pick by role, not by pixel:
 *
 * - `nano`    (9px)  — dense grids, rings, tightly-packed chips
 * - `micro`   (10px) — component-level labels (bottom nav, card sub-labels)
 * - `caption` (11px) — page-section headers, form field labels
 *
 * Tone maps to existing color tokens. Default is `secondary`.
 */
export type EyebrowSize = "nano" | "micro" | "caption";
export type EyebrowTone =
  | "primary"
  | "secondary"
  | "tertiary"
  | "accent-ink"
  | "attention-ink";

const SIZE_CLASS: Record<EyebrowSize, string> = {
  nano: "text-nano",
  micro: "text-micro",
  caption: "text-caption",
};

const TONE_CLASS: Record<EyebrowTone, string> = {
  primary: "text-text-primary",
  secondary: "text-text-secondary",
  tertiary: "text-text-tertiary",
  "accent-ink": "text-accent-ink",
  "attention-ink": "text-attention-ink",
};

type EyebrowProps<As extends React.ElementType = "p"> = {
  as?: As;
  size?: EyebrowSize;
  tone?: EyebrowTone;
  /** Font weight token. `bold` is the default; some sites use `black`. */
  weight?: "bold" | "black";
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<As>, "className" | "children">;

export function Eyebrow<As extends React.ElementType = "p">({
  as,
  size = "caption",
  tone = "secondary",
  weight = "bold",
  className,
  children,
  ...rest
}: EyebrowProps<As>) {
  const Comp = (as ?? "p") as React.ElementType;
  return (
    <Comp
      className={cn(
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        weight === "black" ? "font-black" : "font-bold",
        "uppercase tracking-widest",
        className,
      )}
      {...rest}
    >
      {children}
    </Comp>
  );
}
