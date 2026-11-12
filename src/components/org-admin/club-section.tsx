import type { ReactNode } from "react";

export function ClubSection({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-4"><h2 className="font-display text-h3 text-text-primary">{title}</h2>{actions && <div className="flex flex-wrap gap-2 font-sans">{actions}</div>}</div>{children}</section>;
}