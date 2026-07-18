import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";

import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { PageTitle } from "@/components/page-title";
import { FilterBar } from "@/components/plans/filter-bar";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UploadResourceSheet } from "@/components/coach/upload-resource-sheet";
import { getSport, type SportKey } from "@/lib/coach-sports";
import {
  deleteCoachResource,
  listCoachResources,
  type CoachResourceDTO,
  type CoachResourceKind,
  type LibraryResourceDTO,
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

function sportLabel(s: string) {
  return getSport(s as SportKey)?.label ?? s;
}

function KindIcon({ kind }: { kind: CoachResourceKind }) {
  if (kind === "image") return <ImageIcon className="h-4 w-4" aria-hidden />;
  if (kind === "link") return <LinkIcon className="h-4 w-4" aria-hidden />;
  return <FileText className="h-4 w-4" aria-hidden />;
}

function CoachResourcesPage() {
  const fetchFn = useServerFn(listCoachResources);
  const { data, isLoading } = useQuery({
    queryKey: ["coach-resources"],
    queryFn: () => fetchFn(),
  });

  const sports = data?.sports ?? [];
  const [selectedSport, setSelectedSport] = useState<string | null>(null);
  const activeSport = selectedSport ?? sports[0] ?? null;
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [view, setView] = useState<"yours" | "library">("yours");

  const yours = useMemo(() => {
    const rows = data?.resources ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeSport && !r.sports.includes(activeSport)) return false;
      if (q && !r.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, activeSport, search]);

  const library = useMemo(() => {
    const rows = data?.libraryResources ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeSport && r.sport !== activeSport) return false;
      if (q && !r.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, activeSport, search]);

  const canUpload = data?.canUpload ?? false;

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-24">
      <PageTitle>Resources</PageTitle>

      <FilterBar className="mt-4">
        <SegmentedToggle
          value={view}
          onChange={setView}
          options={[
            { key: "yours", label: "Your uploads" },
            { key: "library", label: "Gradus library" },
          ]}
        />
        {sports.length > 1 ? (
          <div className="mt-2.5">
            <Select
              value={activeSport ?? undefined}
              onValueChange={(v) => setSelectedSport(v)}
            >
              <SelectTrigger className="h-10 rounded-2xl border-divider bg-card">
                <SelectValue placeholder="Sport" />
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

      <div className="mt-4">
        <UploadCta
          canUpload={canUpload}
          onClick={() => canUpload && setUploadOpen(true)}
        />
      </div>

      <div className="relative mt-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search resources"
          className="h-11 rounded-2xl border-divider bg-card text-sm"
        />
      </div>

      <section className="mt-4">
        {isLoading ? (
          <div className="rounded-2xl border border-divider bg-card p-6 text-sm text-text-secondary">
            Loading…
          </div>
        ) : view === "yours" ? (
          <YourUploads rows={yours} />
        ) : (
          <LibraryList rows={library} />
        )}
      </section>

      <UploadResourceSheet
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        coachSports={sports}
      />

      <CoachBottomNav />
    </div>
  );
}

function UploadCta({
  canUpload,
  onClick,
}: {
  canUpload: boolean;
  onClick: () => void;
}) {
  if (canUpload) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="press flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-accent/50 bg-card px-4 py-4 text-left"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Plus className="h-5 w-5" aria-hidden />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-bold text-text-primary">
            Add a resource
          </span>
          <span className="block text-xs text-text-secondary">
            PDF, image, or link — visible to your connected roster
          </span>
        </span>
      </button>
    );
  }
  return (
    <div className="flex w-full items-center gap-3 rounded-2xl border border-divider bg-card px-4 py-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-text-tertiary">
        <Lock className="h-5 w-5" aria-hidden />
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-text-primary">
            Add a resource
          </span>
          <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-secondary">
            Pro & Club
          </span>
        </div>
        <p className="mt-0.5 text-xs text-text-secondary">
          Upgrade to Coach Pro to publish PDFs, images, and links to your roster.
        </p>
      </div>
    </div>
  );
}

function YourUploads({ rows }: { rows: CoachResourceDTO[] }) {
  const qc = useQueryClient();
  const del = useServerFn(deleteCoachResource);
  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach-resources"] }),
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
        <p className="font-hand text-2xl text-text-secondary">
          No uploads yet.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-divider rounded-2xl border border-divider bg-card">
      {rows.map((r) => (
        <li key={r.id} className="flex items-start gap-3 px-4 py-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-text-secondary">
            <KindIcon kind={r.kind} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-text-primary">
              {r.title}
            </p>
            {r.description ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
                {r.description}
              </p>
            ) : null}
            {r.sports.length ? (
              <p className="mt-1 text-[11px] uppercase tracking-wide text-text-tertiary">
                {r.sports.map(sportLabel).join(" · ")}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              if (confirm("Remove this resource for your roster?")) {
                remove.mutate(r.id);
              }
            }}
            className="rounded-full text-text-secondary hover:text-destructive"
            aria-label="Delete resource"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function LibraryList({ rows }: { rows: LibraryResourceDTO[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
        <p className="font-hand text-2xl text-text-secondary">
          No library items for this sport yet.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-divider rounded-2xl border border-divider bg-card">
      {rows.map((r) => (
        <li key={r.id} className="flex items-start gap-3 px-4 py-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-text-secondary">
            <KindIcon kind={r.kind} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-text-primary">
              {r.title}
            </p>
            {r.description ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
                {r.description}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
