import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Eyebrow — small uppercase label used as a section marker or chip caption.
 *
 * Four sizes cover every eyebrow role in the app. Pick by role, not by pixel:
 *
 * - `pico`    (8px)  — bottom-nav tile labels
 * - `nano`    (9px)  — dense grids, rings
 * - `micro`   (10px) — card sub-labels, meta rows
 * - `caption` (11px) — page-section headers, form field labels
 * - `small`   (12px) — page-header eyebrows (e.g. "Internal", "Admin")
 *
 * Tracking defaults to `widest`; opt into `wide` for tabs/meta rows that
 * already read that way in the app.
 *
 * Tone maps to existing color tokens. Default is `secondary`.
 */
export type EyebrowSize = "nano" | "micro" | "caption" | "small";
export type EyebrowTone =
  | "primary"
  | "secondary"
  | "tertiary"
  | "accent-ink"
  | "attention-ink";
export type EyebrowTracking = "wide" | "widest";

const SIZE_CLASS: Record<EyebrowSize, string> = {
  nano: "text-nano",
  micro: "text-micro",
  caption: "text-caption",
  small: "text-xs",
};

const TONE_CLASS: Record<EyebrowTone, string> = {
  primary: "text-text-primary",
  secondary: "text-text-secondary",
  tertiary: "text-text-tertiary",
  "accent-ink": "text-accent-ink",
  "attention-ink": "text-attention-ink",
};

const TRACKING_CLASS: Record<EyebrowTracking, string> = {
  wide: "tracking-wide",
  widest: "tracking-widest",
};

type EyebrowProps<As extends React.ElementType = "p"> = {
  as?: As;
  size?: EyebrowSize;
  tone?: EyebrowTone;
  /** Font weight token. `bold` is the default; some sites use `black` or `normal`. */
  weight?: "normal" | "bold" | "black";
  /** Letter-spacing token. `widest` is the default. */
  tracking?: EyebrowTracking;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<As>, "className" | "children">;

const WEIGHT_CLASS = {
  normal: "font-normal",
  bold: "font-bold",
  black: "font-black",
} as const;

export function Eyebrow<As extends React.ElementType = "p">({
  as,
  size = "caption",
  tone = "secondary",
  weight = "bold",
  tracking = "widest",
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
        WEIGHT_CLASS[weight],
        "uppercase",
        TRACKING_CLASS[tracking],
        className,
      )}
      {...rest}
    >
      {children}
    </Comp>
  );
}
