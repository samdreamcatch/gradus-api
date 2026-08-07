import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Card variants — pick by role, not by pixel count:
 *
 * - `row`     (p-4) — list-row cards (roster row, plan-card in a list)
 * - `section` (p-5) — content-section cards + dialog interiors
 *                     (motivation, invite, admin section blocks)
 * - `hero`    (p-6) — empty states and feature/hero cards
 *
 * Providing `variant` opts into the notebook surface style
 * (`rounded-2xl border border-divider bg-card shadow-sm`). Omit it to keep
 * the raw shadcn shape used by low-level primitives.
 */
export type CardVariant = "row" | "section" | "hero";

const VARIANT_CLASS: Record<CardVariant, string> = {
  row: "rounded-2xl border border-divider bg-card p-4 shadow-sm",
  section: "rounded-2xl border border-divider bg-card p-5 shadow-sm",
  hero: "rounded-2xl border border-divider bg-card p-6 shadow-sm",
};

type CardBaseProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  /** Render as a different element (e.g. `article`, `section`). Default `div`. */
  asChild?: never;
  as?: "div" | "article" | "section";
};

const Card = React.forwardRef<HTMLDivElement, CardBaseProps>(
  ({ className, variant, as: As = "div", ...props }, ref) => {
    const Component = As as React.ElementType;
    return (
      <Component
        ref={ref}
        className={cn(
          variant
            ? VARIANT_CLASS[variant]
            : "rounded-xl border bg-card text-card-foreground shadow",
          className,
        )}
        {...props}
      />
    );
  },
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1 p-3", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-3 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-3 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
