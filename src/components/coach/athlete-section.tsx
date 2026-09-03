import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/utils";

/**
 * Shared layout pieces for the athlete detail sheet's sections, so every
 * section on that screen uses the same heading, action slot, and empty state.
 */
export function SectionHeader({
  title,
  action,
  className,
}: {
  title: ReactNode;
  /** Optional single section action — always an outline `Button size="sm"`. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <Eyebrow as="h3" size="caption" tone="tertiary">
        {title}
      </Eyebrow>
      {action ?? null}
    </div>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 rounded-2xl border border-dashed border-divider bg-card/40 px-4 py-4 text-sm text-text-tertiary">
      {children}
    </p>
  );
}
