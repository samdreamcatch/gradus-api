import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ClubTable } from "@/components/org-admin/club-table";
import { ClubGridToolbar, ClubGroupRow } from "@/components/org-admin/club-grid-toolbar";
import { useClubGrid } from "@/components/org-admin/club-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Loader2, Plus } from "lucide-react";
import { z } from "zod";
import {
  listPolicyMatrix,
  exportPolicyProof,
  listPolicyPacks,
  savePolicyPack,
  PACK_CATEGORIES,
  type PolicyPack,
} from "@/lib/trust-center.functions";
import { remindOutstandingAcks } from "@/lib/org-content.functions";
import { useOrgId } from "@/components/org-admin/org-shared";
import { PageTitle } from "@/components/page-title";
import { ClubLibraryNav } from "@/components/org-admin/club-library-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterPill } from "@/components/ui/filter-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SectionLabel } from "@/components/org-admin/trust-ui";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/org-admin/policies")({
  validateSearch: z.object({ doc: z.string().optional(), role: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Policies · Gradus Club Admin" },
      { name: "description", content: "Policy packs and acknowledgement records for your club." },
      { property: "og:title", content: "Policies · Gradus Club Admin" },
      {
        property: "og:description",
        content: "Policy packs and acknowledgement records for your club.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Policies,
});

const CATEGORY_LABEL: Record<(typeof PACK_CATEGORIES)[number], string> = {
  safe_sport: "Safe Sport",
  communication: "Communication",
  travel: "Travel",
  photo_video: "Photo & video",
  medical: "Medical",
  club: "Club-specific",
};
const ROLE_LABEL: Record<string, string> = { coach: "Coach", parent: "Parent", athlete: "Athlete" };
const fmt = (iso: string) => new Date(iso).toLocaleString();

function Policies() {
  const { orgId } = useOrgId();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const matrixFn = useServerFn(listPolicyMatrix);
  const packsFn = useServerFn(listPolicyPacks);
  const remindFn = useServerFn(remindOutstandingAcks);
  const [editing, setEditing] = useState<PolicyPack | "new" | null>(null);
  const isMobile = useIsMobile();

  const matrix = useQuery({
    queryKey: ["policy-matrix", orgId],
    queryFn: () => matrixFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
  });
  const packs = useQuery({
    queryKey: ["policy-packs", orgId],
    queryFn: () => packsFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
    retry: false,
  });

  const role = search.role ?? "all";
  const docs = useMemo(
    () => (matrix.data?.docs ?? []).filter((d) => !search.doc || d.resourceId === search.doc),
    [matrix.data, search.doc],
  );
  const dueFor = (resourceId: string) =>
    matrix.data?.docs.find((d) => d.resourceId === resourceId)?.dueAt ?? null;
  const proofFn = useServerFn(exportPolicyProof);
  const proof = useMutation({
    mutationFn: async (resourceId: string) => {
      if (!orgId) throw new Error("Select a club");
      const result = await proofFn({ data: { organizationId: orgId, resourceId } });
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const people = useMemo(() => {
    const m = new Map<
      string,
      { key: string; name: string; role: string; cells: Record<string, string | null | undefined> }
    >();
    for (const d of docs) {
      for (const s of matrix.data?.signers[d.resourceId] ?? []) {
        if (role !== "all" && s.role !== role) continue;
        const name = s.forAthleteName ? `${s.forAthleteName} (guardian)` : s.name || "Unnamed";
        const row = m.get(s.key) ?? { key: s.key, name, role: s.role, cells: {} };
        row.cells[d.resourceId] = s.acknowledgedAt;
        m.set(s.key, row);
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [docs, matrix.data, role]);

  type Person = (typeof people)[number];
  const signed = (p: Person) => docs.filter((d) => p.cells[d.resourceId]).length;
  const grid = useClubGrid<Person>(
    "policies-matrix",
    [
      { key: "name", label: "Person", sortValue: (p) => p.name, render: (p) => p.name },
      {
        key: "role",
        label: "Role",
        sortValue: (p) => p.role,
        groupValue: (p) => ROLE_LABEL[p.role as keyof typeof ROLE_LABEL] ?? p.role,
        render: (p) => p.role,
      },
      {
        key: "signed",
        label: "Signed",
        sortValue: (p) => signed(p),
        groupValue: (p) => (signed(p) === docs.length ? "All signed" : "Missing a signature"),
        render: (p) => signed(p),
      },
    ],
    people,
  );
  const remind = useMutation({
    mutationFn: (resourceId: string) => remindFn({ data: { organizationId: orgId!, resourceId } }),
    onSuccess: (r) =>
      toast.success(r.notified ? `Reminded ${r.notified} people` : "Everyone has signed"),
    onError: (e: Error) => toast.error(e.message),
  });

  const exportProof = (resourceId: string) => {
    const d = matrix.data?.docs.find((x) => x.resourceId === resourceId);
    if (!d) return;
    const rows = (matrix.data?.signers[resourceId] ?? []).map((s) => [
      d.title,
      d.version,
      ROLE_LABEL[s.role] ?? s.role,
      s.name,
      s.forAthleteName ?? "",
      s.signedBy ?? "",
      s.acknowledgedAt ? fmt(s.acknowledgedAt) : "Outstanding",
    ]);
    downloadCsv(
      `${d.title.replace(/[^\w]+/g, "-").toLowerCase()}-v${d.version}-signoffs.csv`,
      toCsv(
        [
          "Document",
          "Version",
          "Role",
          "Person",
          "On behalf of athlete",
          "Signed by",
          "Acknowledged",
        ],
        rows,
      ),
    );
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6 md:px-8 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <PageTitle>Policies</PageTitle>
        </div>
        <Button className="press" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> New policy pack
        </Button>
      </div>
      <ClubLibraryNav />

      <section>
        <SectionLabel>Policy packs</SectionLabel>
        {packs.isError ? (
          <p className="text-xs text-text-secondary">
            Policy packs will be available once this update is live.
          </p>
        ) : (packs.data?.packs ?? []).length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {packs.data!.packs.map((p) => (
              <button
                key={p.id}
                onClick={() => setEditing(p)}
                className="press rounded-lg border border-divider bg-card p-4 text-left"
              >
                <p className="text-caption uppercase tracking-wide text-text-tertiary">
                  {CATEGORY_LABEL[p.category]}
                </p>
                <p className="font-display text-h3 text-text-primary">{p.name}</p>
                <p className="mt-1 text-xs text-text-secondary">
                  {p.resourceIds.length} document{p.resourceIds.length === 1 ? "" : "s"}
                  {p.dueAt ? ` · due ${new Date(p.dueAt).toLocaleDateString()}` : ""}
                  {p.renewMonths ? ` · renews every ${p.renewMonths} mo` : ""}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-secondary">
            Group required documents into packs, like "Safe Sport" or "Travel", and give them a due
            date.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Sign-off records</SectionLabel>
          <ClubGridToolbar
            activeFilters={(search.doc ? 1 : 0) + (role !== "all" ? 1 : 0)}
            onClear={() => navigate({ search: (p) => ({ ...p, doc: undefined, role: undefined }) })}
          >
            <FilterPill
              aria-label="Document"
              className="w-auto min-w-48"
              value={search.doc ?? "all"}
              onValueChange={(v) =>
                navigate({ search: (p) => ({ ...p, doc: v === "all" ? undefined : v }) })
              }
              options={[
                { value: "all", label: "All documents" },
                ...(matrix.data?.docs ?? []).map((d) => ({ value: d.resourceId, label: d.title })),
              ]}
            />
            <FilterPill
              aria-label="Role"
              className="w-auto min-w-32"
              value={role}
              onValueChange={(v) =>
                navigate({ search: (p) => ({ ...p, role: v === "all" ? undefined : v }) })
              }
              options={[
                { value: "all", label: "Everyone" },
                { value: "coach", label: "Coaches" },
                { value: "parent", label: "Parents" },
                { value: "athlete", label: "Athletes" },
              ]}
            />
            <span className="mx-1 h-6 w-px bg-divider" aria-hidden />
            {grid.menu}
          </ClubGridToolbar>
        </div>

        {matrix.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : !docs.length ? (
          <p className="rounded-lg border border-divider bg-card p-6 text-sm text-text-secondary">
            No documents require acknowledgement yet. Turn it on for a club document in the Resource
            library.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-divider bg-card">
            <ClubTable>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead className="min-w-48">Person</TableHead>
                  <TableHead>Role</TableHead>
                  {docs.map((d) => {
                    const due = dueFor(d.resourceId);
                    return (
                      <TableHead key={d.resourceId} className="min-w-44 align-bottom">
                        <div className="py-1">
                          <p className="text-text-primary">{d.title}</p>
                          <p className="font-mono text-micro text-text-tertiary">
                            v{d.version}
                            {due ? ` · due ${new Date(due).toLocaleDateString()}` : ""}
                          </p>
                          <div className="mt-1 flex gap-3 text-micro">
                            <button
                              className="press text-accent-ink"
                              onClick={() => remind.mutate(d.resourceId)}
                            >
                              Remind
                            </button>
                            <button
                              className="press inline-flex items-center gap-1 text-accent-ink"
                              onClick={() => exportProof(d.resourceId)}
                            >
                              <Download className="size-3" /> CSV
                            </button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="press"
                              disabled={proof.isPending}
                              onClick={() => proof.mutate(d.resourceId)}
                            >
                              <Download className="size-3" /> PDF
                            </Button>
                          </div>
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(grid.groups ?? [{ label: "", rows: grid.rows }]).flatMap((g) => [
                  ...(g.label
                    ? [
                        <ClubGroupRow
                          key={`g-${g.label}`}
                          label={g.label}
                          count={g.rows.length}
                          colSpan={docs.length + 2}
                        />,
                      ]
                    : []),
                  ...g.rows.map((p) => (
                    <TableRow key={p.key} className="text-xs">
                      <TableCell className="py-2 text-text-primary">{p.name}</TableCell>
                      <TableCell className="py-2 text-text-secondary">
                        {ROLE_LABEL[p.role]}
                      </TableCell>
                      {docs.map((d) => (
                        <TableCell key={d.resourceId} className="py-2">
                          <Cell value={p.cells[d.resourceId]} dueAt={dueFor(d.resourceId)} />
                        </TableCell>
                      ))}
                    </TableRow>
                  )),
                ])}
              </TableBody>
            </ClubTable>
          </div>
        )}
      </section>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn("w-full sm:max-w-md", isMobile ? "paper-surface" : "bg-popover")}
        >
          {editing ? (
            <PackForm
              key={editing === "new" ? "new" : editing.id}
              pack={editing === "new" ? null : editing}
              docs={matrix.data?.docs ?? []}
              onDone={() => {
                setEditing(null);
                for (const key of ["policy-packs", "policy-matrix", "trust-center"])
                  qc.invalidateQueries({ queryKey: [key, orgId] });
              }}
              orgId={orgId!}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Cell({ value, dueAt }: { value: string | null | undefined; dueAt: string | null }) {
  if (value === undefined) return <span className="text-text-disabled">—</span>;
  if (value)
    return <span className="text-accent-ink">Signed {new Date(value).toLocaleDateString()}</span>;
  const overdue = dueAt && new Date(dueAt) < new Date();
  return overdue ? (
    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">Overdue</span>
  ) : (
    <span className="rounded-full bg-attention-wash px-2 py-0.5 text-attention-ink">Due</span>
  );
}

function PackForm({
  pack,
  docs,
  orgId,
  onDone,
}: {
  pack: PolicyPack | null;
  docs: { resourceId: string; title: string }[];
  orgId: string;
  onDone: () => void;
}) {
  const saveFn = useServerFn(savePolicyPack);
  const [name, setName] = useState(pack?.name ?? "");
  const [category, setCategory] = useState<PolicyPack["category"]>(pack?.category ?? "safe_sport");
  const [due, setDue] = useState(pack?.dueAt ? pack.dueAt.slice(0, 10) : "");
  const [renew, setRenew] = useState(pack?.renewMonths ? String(pack.renewMonths) : "");
  const [ids, setIds] = useState<string[]>(pack?.resourceIds ?? []);

  const save = useMutation({
    mutationFn: (archive: boolean) =>
      saveFn({
        data: {
          organizationId: orgId,
          id: pack?.id ?? null,
          name,
          category,
          dueAt: due ? new Date(`${due}T23:59:59`).toISOString() : null,
          renewMonths: renew ? Number(renew) : null,
          resourceIds: ids,
          archive,
        },
      }),
    onSuccess: (_r, archive) => {
      toast.success(archive ? "Pack archived" : "Pack saved");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <SheetHeader>
        <SheetTitle>{pack ? "Edit policy pack" : "New policy pack"}</SheetTitle>
        <SheetDescription>Group required documents and set when they're due.</SheetDescription>
      </SheetHeader>
      <div className="space-y-1.5">
        <Label htmlFor="pack-name">Name</Label>
        <Input
          id="pack-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Fall 2026 Safe Sport"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Category</Label>
        <FilterPill
          aria-label="Category"
          value={category}
          onValueChange={(v) => setCategory(v as PolicyPack["category"])}
          options={PACK_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pack-due">Due date</Label>
          <Input id="pack-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pack-renew">Renew every (months)</Label>
          <Input
            id="pack-renew"
            inputMode="numeric"
            value={renew}
            onChange={(e) => setRenew(e.target.value.replace(/\D/g, ""))}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Documents</Label>
        {docs.length ? (
          docs.map((d) => (
            <label key={d.resourceId} className="flex items-center gap-2 text-sm text-text-primary">
              <Checkbox
                checked={ids.includes(d.resourceId)}
                onCheckedChange={(c) =>
                  setIds((prev) =>
                    c ? [...prev, d.resourceId] : prev.filter((x) => x !== d.resourceId),
                  )
                }
              />
              {d.title}
            </label>
          ))
        ) : (
          <p className="text-xs text-text-secondary">
            Require acknowledgement on a club document first.
          </p>
        )}
      </div>
      <div className="flex justify-between gap-2 pt-2">
        {pack ? (
          <Button
            variant="outline"
            className="press"
            onClick={() => save.mutate(true)}
            disabled={save.isPending}
          >
            Archive
          </Button>
        ) : (
          <span />
        )}
        <Button
          className="press"
          onClick={() => save.mutate(false)}
          disabled={!name.trim() || save.isPending}
        >
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Save
        </Button>
      </div>
    </div>
  );
}
