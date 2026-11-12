import type { ReactNode } from "react";

export function ClubTag({ children }: { children: ReactNode }) {
  return <span className="inline-flex shrink-0 items-center rounded-full border border-border-strong px-2 py-0.5 font-sans text-xs font-normal text-text-secondary">{children}</span>;
}