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
        "rounded-[28px] bg-[#DCEAF5] p-2.5 shadow-sm dark:bg-[#1c2a3a]",
        className,
      )}
    >
      {children}
    </div>
  );
}
