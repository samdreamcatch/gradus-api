import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";

import { CoachBottomNav } from "@/components/coach/bottom-nav";
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
import { UploadResourceSheet } from "@/components/coach/upload-resource-sheet";
import {
  AskGradusCard,
  ResourceList,
  ResourceSheet,
  SavedAnswersList,
  sportLabel,
  type ResourceDTO,
} from "@/components/resources/shared";
import {
  deleteCoachResource,
  listCoachResources,
} from "@/lib/coach-resources.functions";

export const Route = createFileRoute("/_authenticated/coach/resources/")({
  component: CoachResourcesPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-3 py-6">
      <div className="rounded-2xl border border-divider bg-card p-6 text-sm text-text-secondary">
        Couldn&apos;t load resources: {error.message}
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-3 py-6 text-sm text-text-secondary">
      Not found.
    </div>
  ),
});

function CoachResourcesPage() {
  const fetchFn = useServerFn(listCoachResources);
  const { data, isLoading } = useQuery({
    queryKey: ["coach-resources"],
    queryFn: () => fetchFn(),
  });

  const qc = useQueryClient();
  const del = useServerFn(deleteCoachResource);
  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach-resources"] }),
  });

  const sports = data?.sports ?? [];
  const canUpload = data?.canUpload ?? false;

  const resources: ResourceDTO[] = useMemo(() => {
    const own: ResourceDTO[] = (data?.resources ?? []).map((r) => ({
      id: r.id,
      sport: r.sports[0] ?? "",
      sports: r.sports,
      title: r.title,
      description: r.description,
      kind: r.kind,
      source: "coach",
      externalUrl: r.externalUrl,
      coachName: null,
    }));
    const lib: ResourceDTO[] = (data?.libraryResources ?? []).map((r) => ({
      id: r.id,
      sport: r.sport,
      sports: [r.sport],
      title: r.title,
      description: r.description,
      kind: r.kind,
      source: "library",
      externalUrl: r.externalUrl,
      coachName: null,
    }));
    return [...own, ...lib];
  }, [data]);

  const [selectedSport, setSelectedSport] = useState<string | null>(null);
  const activeSport = selectedSport ?? sports[0] ?? null;

  const [view, setView] = useState<"ask" | "library" | "saved">("library");
  const [search, setSearch] = useState("");
  const [openResource, setOpenResource] = useState<ResourceDTO | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!activeSport) return [] as ResourceDTO[];
    const q = search.trim().toLowerCase();
    return resources
      .filter((r) => r.sports.includes(activeSport))
      .filter(
        (r) =>
          !q ||
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      );
  }, [resources, activeSport, search]);

  const coachItems = filtered.filter((r) => r.source === "coach");
  const libraryItems = filtered.filter((r) => r.source === "library");

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-24">
      <PageTitle>Resources</PageTitle>

      {sports.length > 0 ? (
        <FilterBar className="mt-4">
          <SegmentedToggle
            value={view}
            onChange={setView}
            options={[
              { key: "library", label: "Library" },
              { key: "ask", label: "Ask Gradus" },
              { key: "saved", label: "Saved" },
            ]}
          />
          <div className="mt-2.5 flex items-center gap-2">
            {sports.length > 1 ? (
              <Select
                value={activeSport ?? undefined}
                onValueChange={(v) => setSelectedSport(v)}
              >
                <SelectTrigger
                  className="h-8 flex-1 rounded-full border-divider bg-card px-3 text-xs font-bold text-text-primary shadow-none"
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
            ) : (
              <div className="flex-1" />
            )}
            <UploadButton
              canUpload={canUpload}
              onClick={() => setUploadOpen(true)}
            />
          </div>
        </FilterBar>
      ) : null}

      {isLoading ? (
        <p className="mt-8 py-5 text-center text-sm text-text-secondary">Loading…</p>
      ) : sports.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
          <p className="font-hand text-2xl text-text-secondary">
            Add sports in Settings to see resources.
          </p>
        </div>
      ) : (
        <>
          {view === "ask" ? (
            <AskGradusCard sport={activeSport!} />
          ) : view === "saved" ? (
            <SavedAnswersList sport={activeSport!} />
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
                        Your uploads
                      </p>
                      <ResourceList
                        rows={coachItems}
                        onOpen={setOpenResource}
                        onDelete={(r) => remove.mutate(r.id)}
                      />
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
        </>
      )}

      <ResourceSheet
        resource={openResource}
        onClose={() => setOpenResource(null)}
      />

      <UploadResourceSheet
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        coachSports={sports}
      />

      <CoachBottomNav />
    </div>
  );
}

function UploadButton({
  canUpload,
  onClick,
}: {
  canUpload: boolean;
  onClick: () => void;
}) {
  const navigate = useNavigate();
  if (canUpload) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Add a resource"
        className="press flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-bold text-accent-foreground"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/coach/paywall", search: { tier: "coach_pro" } })}
      className="press inline-flex shrink-0 items-center rounded-full bg-elevated px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-text-secondary"
    >
      UPGRADE TO EDIT LIBRARY
    </button>
  );
}
