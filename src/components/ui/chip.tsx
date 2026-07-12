import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Chip — interactive pill for tabs, filters, action buttons, selectable options.
 *
 * Renders `<button type="button">` when `onClick` is passed and no `as` override
 * is given; otherwise renders `<span>`. Pass `as` to render as `Link`, `<a>`,
 * or anything else (e.g. `<Chip as={Link} to="/admin/errors">Errors →</Chip>`).
 *
 * Four sizes match the Eyebrow scale so chip and eyebrow labels read from
 * the same vocabulary:
 *
 * - `nano`    (9px)  — tightly-packed inline stamps
 * - `micro`   (10px) — filter row micro-toggles (mono tag-toggles)
 * - `caption` (11px) — sport / filter chips
 * - `small`   (12px, default) — admin tabs, action pills, page-header pills
 *
 * `selected` visually fills the chip with `accent` and overrides `tone`.
 * `tone="accent"` fills the chip solid at rest — use for always-on call-to-action pills.
 * `tone="destructive"` outlines in destructive color and fills on hover.
 * `tone="muted"` softens text to `text-secondary`.
 */
export type ChipSize = "nano" | "micro" | "caption" | "small";
export type ChipTone = "default" | "accent" | "muted" | "destructive";
export type ChipWeight = "medium" | "semibold" | "bold" | "black";
export type ChipTracking = "wide" | "wider" | "widest";

const SIZE_CLASS: Record<ChipSize, string> = {
  nano: "text-nano px-2 py-0.5",
  micro: "text-micro px-2 py-1",
  caption: "text-caption px-3 py-1",
  small: "text-xs px-3 py-1.5",
};

const WEIGHT_CLASS: Record<ChipWeight, string> = {
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
  black: "font-black",
};

const TRACKING_CLASS: Record<ChipTracking, string> = {
  wide: "tracking-wide",
  wider: "tracking-wider",
  widest: "tracking-widest",
};

const TONE_CLASS: Record<ChipTone, string> = {
  default: "border-divider bg-card text-text-primary hover:bg-elevated",
  muted: "border-divider bg-card text-text-secondary hover:bg-elevated",
  accent:
    "border-accent bg-accent text-accent-foreground hover:opacity-90",
  destructive:
    "border-destructive/50 bg-card text-destructive hover:bg-destructive hover:text-white",
};

const SELECTED_CLASS = "border-accent bg-accent text-accent-foreground";

type ChipOwnProps = {
  size?: ChipSize;
  tone?: ChipTone;
  weight?: ChipWeight;
  tracking?: ChipTracking;
  /** When true, forces the accent-filled state, overriding `tone`. */
  selected?: boolean;
  /** Skip the uppercase transform (for chips that show mixed-case content). */
  caseSensitive?: boolean;
  /** Font-mono variant for tag-style toggles (`test ✓`, `mark test`). */
  mono?: boolean;
  className?: string;
  children: React.ReactNode;
};

type ChipProps<As extends React.ElementType = "span"> = ChipOwnProps & {
  as?: As;
} & Omit<React.ComponentPropsWithoutRef<As>, keyof ChipOwnProps | "as">;

export function Chip<As extends React.ElementType = "span">({
  as,
  size = "small",
  tone = "default",
  weight = "semibold",
  tracking = "wider",
  selected = false,
  caseSensitive = false,
  mono = false,
  className,
  children,
  ...rest
}: ChipProps<As>) {
  const hasOnClick = typeof (rest as { onClick?: unknown }).onClick === "function";
  const Comp = (as ?? (hasOnClick ? "button" : "span")) as React.ElementType;
  const isButton = Comp === "button";
  return (
    <Comp
      {...(isButton ? { type: "button" as const } : {})}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-pill border transition",
        SIZE_CLASS[size],
        mono ? "font-mono" : WEIGHT_CLASS[weight],
        !caseSensitive && "uppercase",
        TRACKING_CLASS[tracking],
        selected ? SELECTED_CLASS : TONE_CLASS[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </Comp>
  );
}
