import { Chip } from "@/components/ui/chip";

interface SportChipProps {
  selected: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  type?: "button";
  disabled?: boolean;
}

/**
 * SportChip is a thin wrapper around the shared `<Chip>` primitive so sport
 * pickers stay visually consistent with every other chip in the app. Sport
 * labels are mixed-case (e.g. "Basketball"), so we opt into `caseSensitive`.
 */
export function SportChip({ selected, onClick, children, disabled }: SportChipProps) {
  return (
    <Chip
      as="button"
      caseSensitive
      selected={selected}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Chip>
  );
}
