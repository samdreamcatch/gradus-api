import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FilterBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[28px] bg-[#DCEAF5] p-2.5 shadow-sm dark:bg-[color-mix(in_oklab,var(--background)_88%,var(--card))]",
        className,
      )}
    >
      {children}
    </div>
  );
}
