import { cn } from "@/lib/utils";

export type SegmentedToggleOption<T extends string> = {
  key: T;
  label: string;
  /** Set together with `controls` to expose the toggle as a real tablist. */
  id?: string;
  controls?: string;
};

export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedToggleOption<T>[];
  /** Accessible name; when present the toggle becomes a tablist. */
  label?: string;
}) {
  const asTabs = options.every((o) => o.id && o.controls);
  return (
    <div
      role={asTabs ? "tablist" : undefined}
      aria-label={label}
      className="flex rounded-lg border border-foreground/15 bg-popover p-1 shadow-sm"
    >
      {options.map((t) => (
        <button
          key={t.key}
          type="button"
          role={asTabs ? "tab" : undefined}
          id={t.id}
          aria-controls={t.controls}
          aria-selected={asTabs ? value === t.key : undefined}
          onClick={() => onChange(t.key)}
          className={cn(
            "press-soft flex-1 rounded-md py-1.5 text-sm font-bold",
            value === t.key ? "bg-accent text-accent-foreground shadow-sm" : "text-text-secondary",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
