import { useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const availableSports = [...SPORTS]
    .sort((a, b) => {
      if (a.key === "strength_conditioning") return -1;
      if (b.key === "strength_conditioning") return 1;
      return a.label.localeCompare(b.label);
    })
    .filter((s) => !isLocked(s.key));

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
          <div className="max-h-80 overflow-y-auto py-1" role="listbox" aria-label="Sports">
            {availableSports.length === 0 && customSports.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-text-secondary">No sports.</p>
            )}
            <div className="p-1">
              {availableSports.map((s) => {
                const sel = isSelected(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    role="option"
                    aria-selected={sel}
                    className="press-soft flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    onClick={() => {
                      onToggle({ key: s.key, label: s.label, custom: false });
                    }}
                  >
                    <span className="flex-1">{s.label}</span>
                    {sel && <Check className="h-4 w-4 text-accent-ink" />}
                  </button>
                );
              })}
              {customSports.map((s) => {
                const sel = isSelected(s.key);
                return (
                  <div key={s.key} className="flex items-center gap-1 rounded-sm px-2 py-1">
                    <button
                      type="button"
                      role="option"
                      aria-selected={sel}
                      className="press-soft flex flex-1 items-center gap-2 rounded-sm py-1 text-left text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                      onClick={() => onToggle(s)}
                    >
                      <span className="flex-1">{s.label}</span>
                      {sel && <Check className="h-4 w-4 text-accent-ink" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveCustom(s.key)}
                      className="press-soft rounded p-1 text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
                      aria-label={`Remove ${s.label}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
              {atCap && (
                <>
                  <div className="my-1 border-t border-divider" />
                  <div className="px-3 py-2.5 text-xs text-text-secondary">
                    <div className="space-y-1">
                      <p>
                        Coach plan includes one sport plus Strength &
                        Conditioning.
                      </p>
                      <Link
                        to="/coach/paywall"
                        search={{ tier: "coach_pro" }}
                        className="font-semibold text-accent-ink underline"
                      >
                        Choose Coach Pro for more sports →
                      </Link>
                    </div>
                  </div>
                </>
              )}
              {showCustom && (
                <>
                  <div className="my-1 border-t border-divider" />
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
          </div>
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
