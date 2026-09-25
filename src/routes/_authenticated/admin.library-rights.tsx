import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SPORTS } from "@/lib/coach-sports";
import {
  adminListLibraryRights,
  adminSetLibraryRights,
  LIBRARY_RIGHTS,
  LIBRARY_RIGHTS_LABEL,
  type LibraryRights,
  type LibraryRightsRowDTO,
} from "@/lib/admin-library-rights.functions";

export const Route = createFileRoute("/_authenticated/admin/library-rights")({
  component: LibraryRightsPage,
});

const TONE: Record<LibraryRights, "default" | "accent" | "muted"> = {
  gradus: "accent",
  licensed: "accent",
  pending: "muted",
};

function sportLabel(key: string) {
  return SPORTS.find((s) => s.key === key)?.label ?? key;
}

function LibraryRightsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListLibraryRights);
  const setFn = useServerFn(adminSetLibraryRights);
  const list = useQuery({ queryKey: ["admin-library-rights"], queryFn: () => listFn() });

  const set = useMutation({
    mutationFn: (input: { id: string; rights: LibraryRights }) => setFn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-library-rights"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const [filter, setFilter] = useState("");
  const [rightsFilter, setRightsFilter] = useState<"all" | LibraryRights>("all");
  const rows = list.data?.rows ?? [];
  const needle = filter.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (rightsFilter !== "all" && r.rights !== rightsFilter) return false;
    if (!needle) return true;
    return [r.title, sportLabel(r.sport), r.kind].join(" ").toLowerCase().includes(needle);
  });
  const counts = LIBRARY_RIGHTS.map((k) => [k, rows.filter((r) => r.rights === k).length] as const);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-10">
      <header className="space-y-3">
        <Eyebrow>Content</Eyebrow>
        <h1 className="font-display text-3xl">Library rights</h1>
        <p className="text-text-secondary max-w-prose">
          Which curated documents the iOS app may show. The store app lists a document only when it
          is marked <strong>Gradus-authored</strong> or <strong>Licensed</strong>; anything{" "}
          <strong>Pending</strong> stays on the web only. Coach uploads are not listed here: the
          coach owns those. Related: PRD §12 #16 and the App Store content-rights question.
        </p>
        <div className="flex flex-wrap gap-2">
          {counts.map(([k, n]) => (
            <Tag key={k} tone={TONE[k]}>
              {LIBRARY_RIGHTS_LABEL[k]}: {n}
            </Tag>
          ))}
        </div>
      </header>

      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by title, sport or kind"
            aria-label="Search library documents"
          />
          <Select
            value={rightsFilter}
            onValueChange={(v) => setRightsFilter(v as typeof rightsFilter)}
          >
            <SelectTrigger aria-label="Filter by rights status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              {LIBRARY_RIGHTS.map((k) => (
                <SelectItem key={k} value={k}>
                  {LIBRARY_RIGHTS_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {list.isLoading ? (
          <p className="text-text-secondary">Loading…</p>
        ) : !rows.length ? (
          <p className="text-text-secondary">No curated documents yet.</p>
        ) : !visible.length ? (
          <p className="text-text-secondary">Nothing matches.</p>
        ) : (
          <ul className="divide-y divide-divider rounded-xl border border-divider bg-card">
            {visible.map((r) => (
              <LibraryRow
                key={r.id}
                row={r}
                pending={set.isPending && set.variables?.id === r.id}
                onChange={(rights) => set.mutate({ id: r.id, rights })}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LibraryRow({
  row,
  pending,
  onChange,
}: {
  row: LibraryRightsRowDTO;
  pending: boolean;
  onChange: (rights: LibraryRights) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.title}</span>
          {!row.published && <Tag tone="muted">Unpublished</Tag>}
        </div>
        <div className="text-xs text-text-secondary">
          {sportLabel(row.sport)} · {row.kind.toUpperCase()}
        </div>
      </div>
      <div className="w-56">
        <Select
          value={row.rights}
          onValueChange={(v) => onChange(v as LibraryRights)}
          disabled={pending}
        >
          <SelectTrigger aria-label={`Rights status for ${row.title}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIBRARY_RIGHTS.map((k) => (
              <SelectItem key={k} value={k}>
                {LIBRARY_RIGHTS_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </li>
  );
}
