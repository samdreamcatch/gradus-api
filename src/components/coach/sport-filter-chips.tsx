import { Chip } from "@/components/ui/chip";
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
        <Chip caseSensitive tone="accent">
          {sportLabel(sports[0])}
        </Chip>
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
          <Chip
            key={opt.key ?? "__all"}
            caseSensitive
            tone="muted"
            selected={isActive}
            onClick={() => onSelect(opt.key)}
          >
            {opt.label}
          </Chip>
        );
      })}
    </div>
  );
}
