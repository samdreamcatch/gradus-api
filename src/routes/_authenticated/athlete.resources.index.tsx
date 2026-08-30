import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { AthleteBottomNav } from "@/components/athlete/bottom-nav";
import { PageTitle } from "@/components/page-title";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import { FilterBar } from "@/components/plans/filter-bar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  ResourceList,
  ResourceSheet,
  sportLabel,
  type ResourceDTO,
} from "@/components/resources/shared";
import { SafeSportPanel } from "@/components/resources/safe-sport-panel";
import { getAthleteResources } from "@/lib/athlete-resources.functions";

export const Route = createFileRoute("/_authenticated/athlete/resources/")({
  component: AthleteResourcesPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-3 py-6">
      <div className="rounded-2xl border border-divider bg-card p-6 text-sm text-text-secondary">
        Couldn&apos;t load resources: {error.message}
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-3 py-6 text-sm text-text-secondary">Not found.</div>
  ),
});

function AthleteResourcesPage() {
  const fetchResources = useServerFn(getAthleteResources);
  const { data, isLoading } = useQuery({
    queryKey: ["athlete-resources"],
    queryFn: () => fetchResources(),
  });

  const sports = data?.sports ?? [];
  const resources = data?.resources ?? [];

  const [selectedSport, setSelectedSport] = useState<string | null>(null);
  const activeSport = selectedSport ?? sports[0] ?? null;

  const [view, setView] = useState<"library" | "safe-sport">("library");
  const [search, setSearch] = useState("");
  const [openResource, setOpenResource] = useState<ResourceDTO | null>(null);

  const filtered = useMemo(() => {
    if (!activeSport) return [] as ResourceDTO[];
    const q = search.trim().toLowerCase();
    return resources
      .filter((r) => r.sports.includes(activeSport))
      .filter(
        (r) => !q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
      );
  }, [resources, activeSport, search]);

  const coachItems = filtered.filter((r) => r.source === "coach");
  const libraryItems = filtered.filter((r) => r.source === "library");

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-app-chrome">
      <PageTitle>Resources</PageTitle>

      <FilterBar className="mt-4">
        <SegmentedToggle
          value={view}
          onChange={setView}
          options={[
            { key: "library", label: "Library" },
            { key: "safe-sport", label: "Safe Sport" },
          ]}
        />
        {view !== "safe-sport" && sports.length > 1 ? (
          <div className="mt-2.5">
            <Select value={activeSport ?? undefined} onValueChange={(v) => setSelectedSport(v)}>
              <SelectTrigger
                className="h-8 w-full rounded-full border-divider bg-card px-3 text-xs font-bold text-text-primary shadow-none"
                aria-label="Sport"
              >
                <SelectValue placeholder="Select sport" />
              </SelectTrigger>
              <SelectContent>
                {sports.map((s) => (
                  <SelectItem key={s} value={s}>
                    {sportLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </FilterBar>

      {view === "safe-sport" ? (
        <SafeSportPanel />
      ) : isLoading ? (
        <p className="mt-8 py-5 text-center text-sm text-text-secondary">Loading…</p>
      ) : sports.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
          <p className="font-hand text-2xl text-text-secondary">
            Add a sport to your profile to see resources.
          </p>
        </div>
      ) : (
        <section className="mt-5 space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${sportLabel(activeSport!).toLowerCase()} library`}
              className="h-11 rounded-2xl border-divider bg-card pl-9 text-sm"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
              <p className="font-hand text-2xl text-text-secondary">
                {search
                  ? "No resources match that search."
                  : `No ${sportLabel(activeSport!).toLowerCase()} resources yet.`}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {coachItems.length > 0 ? (
                <div className="space-y-2">
                  <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                    From your coaches
                  </p>
                  <ResourceList rows={coachItems} onOpen={setOpenResource} showCoach />
                </div>
              ) : null}
              {libraryItems.length > 0 ? (
                <div className="space-y-2">
                  {coachItems.length > 0 ? (
                    <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                      Gradus library
                    </p>
                  ) : null}
                  <ResourceList rows={libraryItems} onOpen={setOpenResource} />
                </div>
              ) : null}
            </div>
          )}
        </section>
      )}

      <ResourceSheet resource={openResource} onClose={() => setOpenResource(null)} />

      <AthleteBottomNav />
    </div>
  );
}
