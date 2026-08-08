import type { LucideIcon } from "lucide-react";
import { Eyebrow } from "@/components/ui/eyebrow";

export function StubPage({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="rounded-xl border border-divider bg-card p-8 space-y-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-elevated text-accent-ink">
            <Icon className="size-5" />
          </div>
          <div>
            <Eyebrow size="small" tone="accent-ink">
              Coming soon
            </Eyebrow>
            <h2 className="font-display text-h2 text-text-primary leading-tight">{title}</h2>
          </div>
        </div>
        <p className="text-sm text-text-secondary">{description}</p>
      </div>
    </div>
  );
}
