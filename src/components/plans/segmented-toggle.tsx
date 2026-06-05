import { cn } from "@/lib/utils";

export type SegmentedToggleOption<T extends string> = {
  key: T;
  label: string;
};

export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedToggleOption<T>[];
}) {
  return (
    <div className="flex rounded-lg border border-foreground/15 bg-popover p-1 shadow-sm">
      {options.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            "flex-1 rounded-md py-1.5 text-sm font-bold transition",
            value === t.key
              ? "bg-accent text-accent-foreground shadow-sm"
              : "text-text-secondary hover:text-text-primary",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
