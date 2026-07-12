import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tag — static meta stamp. Non-interactive; renders `<span>`.
 *
 * Used for the `test` / `adult` / `custom` / `unsaved` labels attached to
 * headings and rows across the admin surfaces. Defaults to `font-mono` since
 * every current usage is mono; opt out with `mono={false}`.
 *
 * Sizes match Eyebrow / Chip:
 *
 * - `nano`    (9px)
 * - `micro`   (10px, default) — inline row stamps
 * - `caption` (11px) — heading-adjacent stamps
 * - `small`   (12px)
 */
export type TagSize = "nano" | "micro" | "caption" | "small";
export type TagTone = "default" | "accent" | "muted";

const SIZE_CLASS: Record<TagSize, string> = {
  nano: "text-nano px-1.5 py-0.5",
  micro: "text-micro px-1.5 py-0.5",
  caption: "text-caption px-2 py-0.5",
  small: "text-xs px-2 py-0.5",
};

const TONE_CLASS: Record<TagTone, string> = {
  default: "border-divider bg-elevated text-text-tertiary",
  muted: "border-divider bg-card text-text-tertiary",
  accent: "border-accent/40 bg-accent/10 text-accent-ink",
};

type TagProps = {
  size?: TagSize;
  tone?: TagTone;
  /** Font-mono. Defaults to `true` — matches all existing static stamps. */
  mono?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<"span">, "className" | "children">;

export function Tag({
  size = "micro",
  tone = "default",
  mono = true,
  className,
  children,
  ...rest
}: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border uppercase tracking-wider",
        SIZE_CLASS[size],
        mono ? "font-mono" : "font-medium",
        TONE_CLASS[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
