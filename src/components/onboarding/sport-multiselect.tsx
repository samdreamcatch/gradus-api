import { useState } from "react";
import { Check, ChevronDown, Lock, Plus, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { SPORTS } from "@/lib/coach-sports";

export type SelectedSport = { key: string; label: string; custom: boolean };

export function slugifySport(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Sport keys that never count against the primary-sport cap. */
const DEFAULT_ALWAYS_ALLOWED_SECONDARY = ["strength_conditioning"];

interface Props {
  selected: SelectedSport[];
  customSports: SelectedSport[];
  onToggle: (sport: SelectedSport) => void;
  onAddCustom: (label: string) => { status: "added" | "selected-existing"; label: string };
  onRemoveCustom: (key: string) => void;
  allowCustom?: boolean;
  /**
   * Cap on primary sports the coach can pick. `strength_conditioning` (and any
   * key in `alwaysAllowedSecondary`) is exempt. When the cap is reached,
   * unselected non-exempt sports appear locked with an inline upgrade CTA.
   */
  maxPrimarySports?: number;
  alwaysAllowedSecondary?: string[];
}

export function SportMultiselect({
  selected,
  customSports,
  onToggle,
  onAddCustom,
  onRemoveCustom,
  allowCustom = true,
  maxPrimarySports,
  alwaysAllowedSecondary = DEFAULT_ALWAYS_ALLOWED_SECONDARY,
}: Props) {
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [hint, setHint] = useState<string | null>(null);

  const isSelected = (key: string) => selected.some((s) => s.key === key);
  const isSecondaryOnly = (key: string) => alwaysAllowedSecondary.includes(key);
  const primaryCount = selected.filter((s) => !isSecondaryOnly(s.key)).length;
  const atCap =
    typeof maxPrimarySports === "number" && primaryCount >= maxPrimarySports;
  // Locked = would exceed the primary cap if added. Already-selected sports
  // stay clickable so they can be removed.
  const isLocked = (key: string) =>
    atCap && !isSelected(key) && !isSecondaryOnly(key);
  // Custom sports always count as primary; hide the input entirely when capped.
  const showCustom = allowCustom && !atCap;


  const handleAdd = () => {
    const label = customInput.trim();
    if (!label) return;
    const result = onAddCustom(label);
    setCustomInput("");
    if (result.status === "selected-existing") {
      setHint(`'${result.label}' already exists — selected for you.`);
    } else {
      setHint(null);
    }
  };

  return (
    <div className="space-y-3">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setHint(null); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-between rounded-md border-2 border-divider bg-card px-4 py-3 text-left text-sm font-semibold text-text-primary transition",
              "hover:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2",
            )}
          >
            <span className={selected.length === 0 ? "text-text-secondary font-normal" : ""}>
              {selected.length === 0
                ? "Select sports"
                : selected.map((s) => s.label).join(", ")}
            </span>
            <ChevronDown className="h-4 w-4 text-text-secondary" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[--radix-popover-trigger-width] min-w-[280px] p-0"
        >
          <Command>
            <CommandList>
              <CommandEmpty>No sports.</CommandEmpty>
              <CommandGroup>
                {SPORTS.map((s) => {
                  const sel = isSelected(s.key);
                  const locked = isLocked(s.key);
                  return (
                    <CommandItem
                      key={s.key}
                      value={s.label}
                      disabled={locked}
                      onSelect={() => {
                        if (locked) return;
                        onToggle({ key: s.key, label: s.label, custom: false });
                      }}
                      className={cn(locked && "opacity-60")}
                    >
                      <span className="flex-1">{s.label}</span>
                      {locked && !sel && (
                        <Lock className="h-3.5 w-3.5 text-text-tertiary" />
                      )}
                      {sel && <Check className="h-4 w-4 text-accent-ink" />}
                    </CommandItem>
                  );
                })}
                {customSports.map((s) => {
                  const sel = isSelected(s.key);
                  return (
                    <CommandItem
                      key={s.key}
                      value={s.label}
                      onSelect={() => onToggle(s)}
                    >
                      <span className="flex-1">{s.label}</span>
                      {sel && <Check className="h-4 w-4 text-accent-ink" />}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveCustom(s.key);
                        }}
                        className="ml-2 rounded p-0.5 text-text-tertiary hover:bg-divider hover:text-text-primary"
                        aria-label={`Remove ${s.label}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {allowCustom && (
                <>
                  <CommandSeparator />
                  <div className="p-2">
                    <p className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                      Custom
                    </p>
                    <div className="flex gap-2">
                      <Input
                        value={customInput}
                        onChange={(e) => {
                          setCustomInput(e.target.value);
                          if (hint) setHint(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAdd();
                          }
                        }}
                        placeholder="Name your sport"
                        className="h-9 text-sm"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAdd}
                        disabled={!customInput.trim()}
                      >
                        <Plus className="h-4 w-4" />
                        Add
                      </Button>
                    </div>
                    {hint && (
                      <p className="mt-2 px-1 text-xs text-text-secondary">{hint}</p>
                    )}
                  </div>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>


      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((s) => (
            <span
              key={s.key}
              className="inline-flex items-center gap-1.5 rounded-pill border border-accent bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground"
            >
              {s.label}
              <button
                type="button"
                onClick={() => onToggle(s)}
                className="rounded-full p-0.5 hover:bg-black/10"
                aria-label={`Remove ${s.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
