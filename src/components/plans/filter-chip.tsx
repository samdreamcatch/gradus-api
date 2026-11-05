import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A pill in a horizontal filter row (Library sport chips, the Add moves picker). */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "press whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold",
        active
          ? "border-accent/70 bg-accent text-accent-foreground"
          : "border-divider bg-card text-text-secondary",
      )}
    >
      {children}
    </button>
  );
}
