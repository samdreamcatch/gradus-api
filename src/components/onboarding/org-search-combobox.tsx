import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronDown, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  getPopularOrganizations,
  searchOrganizations,
} from "@/lib/coach-org.functions";

export type OrgOption = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  logoUrl: string | null;
};

interface Props {
  selected: OrgOption | null;
  onSelect: (org: OrgOption) => void;
  onNotListed: (typedQuery: string) => void;
}

/**
 * Slack/Notion-style workspace picker for finding the coach's club. Uses the
 * same shadcn `Command` + `Popover` primitives as the sport picker so it
 * reads as a familiar pattern. Anchors to the trigger's top on mobile per
 * the project's overlay doctrine.
 */
export function OrgSearchCombobox({ selected, onSelect, onNotListed }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  const search = useServerFn(searchOrganizations);
  const popular = useServerFn(getPopularOrganizations);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(t);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ["org-search", debounced],
    queryFn: () => search({ data: { query: debounced } }),
    enabled: open && debounced.length > 0,
  });

  const popularQuery = useQuery({
    queryKey: ["org-popular"],
    queryFn: () => popular(),
    enabled: open && debounced.length === 0,
  });

  const results = useMemo<OrgOption[]>(() => {
    const source =
      debounced.length > 0
        ? searchQuery.data?.organizations ?? []
        : popularQuery.data?.organizations ?? [];
    return source.map((o) => ({
      id: o.id,
      name: o.name,
      city: o.city,
      region: o.region,
      logoUrl: o.logoUrl,
    }));
  }, [debounced, searchQuery.data, popularQuery.data]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between rounded-md border-2 border-divider bg-card px-4 py-3 text-left text-sm transition",
            "hover:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2",
          )}
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-accent-ink" />
              <span className="truncate">
                <span className="font-semibold text-text-primary">
                  {selected.name}
                </span>
                {(selected.city || selected.region) && (
                  <span className="ml-2 text-text-secondary">
                    {[selected.city, selected.region]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                )}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-2 text-text-secondary">
              <Search className="h-4 w-4" />
              Search for your club
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-text-secondary" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[--radix-popover-trigger-width] min-w-[280px] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name or city"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {results.length === 0 &&
              !searchQuery.isFetching &&
              !popularQuery.isFetching && (
                <CommandEmpty>
                  {debounced.length > 0
                    ? "No matches. Your club may not be on Gradus yet."
                    : "Start typing your club's name."}
                </CommandEmpty>
              )}
            {results.length > 0 && (
              <CommandGroup
                heading={debounced.length > 0 ? "Matches" : "Popular clubs"}
              >
                {results.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={o.id}
                    onSelect={() => {
                      onSelect(o);
                      setOpen(false);
                    }}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="font-semibold text-text-primary">
                      {o.name}
                    </span>
                    {(o.city || o.region) && (
                      <span className="text-xs text-text-secondary">
                        {[o.city, o.region].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="__not-listed__"
                onSelect={() => {
                  onNotListed(debounced);
                  setOpen(false);
                }}
                className="text-text-secondary"
              >
                My club isn&apos;t listed — continue as individual
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
