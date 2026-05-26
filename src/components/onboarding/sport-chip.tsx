import { cn } from "@/lib/utils";

interface SportChipProps {
  selected: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  type?: "button";
  disabled?: boolean;
}

export function SportChip({ selected, onClick, children, disabled }: SportChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-pill border-2 px-5 py-2.5 text-sm font-semibold transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-accent bg-accent text-accent-foreground shadow-sm"
          : "border-divider bg-card text-text-primary hover:border-accent/40",
      )}
    >
      {children}
    </button>
  );
}
