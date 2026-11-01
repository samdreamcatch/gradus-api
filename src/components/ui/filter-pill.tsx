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
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

interface MultiFilterPillProps {
  value: string[];
  onValueChange: (value: string[]) => void;
  options: FilterPillOption[];
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

/** Same pill as FilterPill, but lets you tick several options. Keeps at least one selected. */
export function MultiFilterPill({
  value,
  onValueChange,
  options,
  placeholder = "Choose",
  className,
  "aria-label": ariaLabel,
}: MultiFilterPillProps) {
  const chosen = options.filter((o) => value.includes(o.value));
  const label = chosen.length ? chosen.map((o) => o.label).join(", ") : placeholder;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={ariaLabel}
        className={cn(
          "press inline-flex h-8 w-full items-center justify-between gap-2 rounded-full border border-foreground/15 bg-popover px-3 text-xs font-bold text-text-primary shadow-sm",
          className,
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={value.includes(opt.value)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) => {
              const next = on ? [...value, opt.value] : value.filter((v) => v !== opt.value);
              if (next.length) onValueChange(options.map((o) => o.value).filter((v) => next.includes(v)));
            }}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
