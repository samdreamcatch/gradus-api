import { cn } from "@/lib/utils";
import { getSport, type SportKey } from "@/lib/coach-sports";

function sportLabel(sport: string): string {
  return getSport(sport as SportKey)?.label ?? sport;
}

interface SportFilterChipsProps {
  sports: string[];
  selected: string | null;
  onSelect: (sport: string | null) => void;
}

export function SportFilterChips({ sports, selected, onSelect }: SportFilterChipsProps) {
  if (sports.length === 0) return null;

  if (sports.length === 1) {
    return (
      <div className="mt-4">
        <span className="inline-block rounded-pill border border-divider bg-card px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-accent-ink">
          {sportLabel(sports[0])}
        </span>
      </div>
    );
  }

  const options: Array<{ key: string | null; label: string }> = [
    { key: null, label: "All" },
    ...sports.map((s) => ({ key: s, label: sportLabel(s) })),
  ];

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {options.map((opt) => {
        const isActive = selected === opt.key;
        return (
          <button
            key={opt.key ?? "__all"}
            type="button"
            onClick={() => onSelect(opt.key)}
            className={cn(
              "rounded-pill border px-3 py-1 text-[11px] font-bold uppercase tracking-widest transition",
              isActive
                ? "border-accent bg-accent text-accent-foreground"
                : "border-divider bg-card text-text-secondary hover:text-text-primary",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
