/**
 * FilterPill — the canonical list-filter primitive.
 *
 * Use for list filters (status, entity, taxonomy) that narrow a collection.
 * Not for primary navigation or view toggles — those stay segmented.
 *
 * Wraps shadcn Select with the rounded pill trigger styling shared across
 * coach/plans, coach/roster, and the athlete/parent plan surfaces. Handles
 * the "__all" sentinel so callers can pass an empty string or null for the
 * unfiltered state.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type FilterPillOption = {
  value: string;
  label: string;
};

interface FilterPillProps {
  value: string;
  onValueChange: (value: string) => void;
  options: FilterPillOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label": string;
}

export function FilterPill({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  "aria-label": ariaLabel,
}: FilterPillProps) {
  const isDisabled = disabled || options.length <= 1;
  return (
    <Select value={value} onValueChange={onValueChange} disabled={isDisabled}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "press h-8 w-full rounded-full border border-foreground/15 bg-popover px-3 text-xs font-bold text-text-primary shadow-sm",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
