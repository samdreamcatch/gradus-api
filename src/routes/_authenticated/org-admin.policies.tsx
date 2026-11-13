import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ClubGridToolbar } from "@/components/org-admin/club-grid-toolbar";
import { ClubDataGrid, useClubGrid } from "@/components/org-admin/club-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bell, Download, Loader2, Plus, X } from "lucide-react";
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
import { ClubPageHeader } from "@/components/org-admin/club-page-header";
import { ClubLibraryNav } from "@/components/org-admin/club-library-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterPill } from "@/components/ui/filter-pill";
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
import { selectedOutstandingSigners } from "@/lib/club-policy";

export const Route = createFileRoute("/_authenticated/org-admin/policies")({
  validateSearch: z.object({ doc: z.string().optional(), role: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Acknowledgements · Gradus Club Admin" },
      { name: "description", content: "Policy packs and acknowledgement records for your club." },
      { property: "og:title", content: "Acknowledgements · Gradus Club Admin" },
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<RecordRow[] | null>(null);
  const [preparedPdf, setPreparedPdf] = useState<{
    resourceId: string;
    blob: Blob;
    filename: string;
  } | null>(null);
  const proofFn = useServerFn(exportPolicyProof);
  const proof = useMutation({
    mutationFn: async (resourceId: string) => {
      if (!orgId) throw new Error("Select a club");
      const result = await proofFn({ data: { organizationId: orgId, resourceId } });
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      return {
        resourceId,
        blob: new Blob([bytes], { type: "application/pdf" }),
        filename: result.filename,
      };
    },
    onSuccess: (result) => {
      setPreparedPdf(result);
      toast.success("PDF ready. Select Download PDF to save it.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const downloadPdf = () => {
    if (!preparedPdf) return;
    const url = URL.createObjectURL(preparedPdf.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = preparedPdf.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const records = useMemo(
    () =>
      docs.flatMap((d) =>
        (matrix.data?.signers[d.resourceId] ?? [])
          .filter((s) => role === "all" || s.role === role)
          .map((s) => ({
            ...s,
            id: `${d.resourceId}:${s.key}`,
            resourceId: d.resourceId,
            document: d.title,
            version: d.version,
            dueAt: d.dueAt,
          })),
      ),
    [docs, matrix.data, role],
  );
  type RecordRow = (typeof records)[number];
  const selectable = selectedOutstandingSigners(records);
  const selectedRows = selectable.filter((r) => selected.has(r.id));
  const selectRows = (rows: RecordRow[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of selectedOutstandingSigners(rows)) {
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  const selectionControl = (rows: RecordRow[], label: string) => {
    const pending = selectedOutstandingSigners(rows);
    const count = pending.filter((r) => selected.has(r.id)).length;
    return (
      <Checkbox
        aria-label={label}
        disabled={!pending.length}
        checked={count > 0 && count === pending.length ? true : count > 0 ? "indeterminate" : false}
        onCheckedChange={(on) => selectRows(rows, on === true)}
      />
    );
  };
  const grid = useClubGrid<RecordRow>(
    "policy-records",
    [
      {
        key: "person",
        label: "Person",
        className: "min-w-56",
        headerControl: (
          <label className="mr-3 inline-flex items-center gap-2">
            {selectionControl(records, "Select all outstanding acknowledgements")}
            <span>Select all</span>
          </label>
        ),
        sortValue: (r) => r.name,
        render: (r) => (
          <span className="inline-flex items-center gap-3">
            <Checkbox
              aria-label={`Select ${r.name} for ${r.document}`}
              disabled={!!r.acknowledgedAt}
              checked={selected.has(r.id)}
              onCheckedChange={(on) => selectRows([r], on === true)}
            />
            {r.name || "Unnamed"}
          </span>
        ),
      },
      {
        key: "document",
        label: "Document",
        sortValue: (r) => r.document,
        groupValue: (r) => r.document,
        render: (r) => `${r.document} · v${r.version}`,
        className: "min-w-56 whitespace-normal",
      },
      {
        key: "role",
        label: "Role",
        sortValue: (r) => r.role,
        render: (r) => (r.forAthleteId ? "Guardian for athlete" : ROLE_LABEL[r.role]),
      },
      {
        key: "status",
        label: "Status",
        sortValue: (r) => (r.acknowledgedAt ? "Signed" : "Due"),
        render: (r) => <Cell value={r.acknowledgedAt} dueAt={r.dueAt} />,
      },
      { key: "signedBy", label: "Signed by", render: (r) => r.signedBy || "—" },
      {
        key: "action",
        label: "",
        render: (r) =>
          !r.acknowledgedAt && (
            <Button
              variant="ghost"
              size="sm"
              className="press"
              aria-label={`Remind ${r.name} about ${r.document}`}
              onClick={() => setReview([r])}
            >
              <Bell className="size-3" />
              Remind
            </Button>
          ),
      },
    ],
    records,
    { group: "document" },
  );
  const remind = useMutation({
    mutationFn: async (rows: RecordRow[]) => {
      if (!orgId) throw new Error("Select a club");
      let notified = 0;
      for (const resourceId of new Set(rows.map((r) => r.resourceId))) {
        const result = await remindFn({
          data: {
            organizationId: orgId,
            resourceId,
            signerKeys: rows.filter((r) => r.resourceId === resourceId).map((r) => r.key),
          },
        });
        notified += result.notified;
      }
      return notified;
    },
    onSuccess: (count) => {
      toast.success(
        count
          ? `Reminders requested for ${count} recipients`
          : "No outstanding recipients to remind",
      );
      setReview(null);
      setSelected(new Set());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportRecords = (rows: RecordRow[], filename = "club-acknowledgements.csv") =>
    downloadCsv(
      filename,
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
        rows.map((r) => [
          r.document,
          r.version,
          ROLE_LABEL[r.role],
          r.name,
          r.forAthleteName ?? "",
          r.signedBy ?? "",
          r.acknowledgedAt ? fmt(r.acknowledgedAt) : "Outstanding",
        ]),
      ),
    );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <ClubPageHeader title="Acknowledgements" />
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
            <Button variant="outline" className="press" onClick={() => exportRecords(records)}>
              <Download className="size-4" />
              Export CSV
            </Button>
          </ClubGridToolbar>
        </div>

        {matrix.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : matrix.isError ? (
          <p className="text-sm text-destructive">Acknowledgement records could not be loaded. Try again.</p>
        ) : !docs.length ? (
          <p className="rounded-lg border border-divider bg-card p-6 text-sm text-text-secondary">
            No documents require acknowledgement yet. Turn it on for a club document in the Resource
            library.
          </p>
        ) : (
          <div className="space-y-3">
            {selectedRows.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-y border-divider py-2">
                <span className="font-mono text-sm">{selectedRows.length} selected</span>
                <Button className="press" onClick={() => setReview(selectedRows)}>
                  <Bell className="size-4" />
                  Remind selected
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="press"
                  aria-label="Clear selection"
                  onClick={() => setSelected(new Set())}
                >
                  <X className="size-4" />
                </Button>
              </div>
            )}
            <ClubDataGrid
              grid={grid}
              rowKey={(r) => r.id}
              empty="No acknowledgement records"
              filtered={!!search.doc || role !== "all"}
              groupControl={(label, rows) => (
                <span className="inline-flex flex-wrap items-center gap-3">
                  {selectionControl(rows, `Select outstanding acknowledgements for ${label}`)}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="press"
                    disabled={!selectedOutstandingSigners(rows).length}
                    onClick={() => setReview(selectedOutstandingSigners(rows))}
                  >
                    Remind outstanding
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="press"
                    onClick={() => exportRecords(rows)}
                  >
                    <Download className="size-3" />
                    CSV
                  </Button>
                  {rows[0] && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="press"
                      disabled={proof.isPending}
                      onClick={() =>
                        preparedPdf?.resourceId === rows[0]?.resourceId
                          ? downloadPdf()
                          : rows[0] && proof.mutate(rows[0].resourceId)
                      }
                    >
                      {proof.isPending && proof.variables === rows[0].resourceId ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                      {proof.isPending && proof.variables === rows[0].resourceId ? "Preparing PDF…" : preparedPdf?.resourceId === rows[0].resourceId
                        ? "Download PDF"
                        : "Prepare PDF"}
                    </Button>
                  )}
                </span>
              )}
            />
            {!grid.groups &&
              docs.map((d) => (
                <div
                  key={d.resourceId}
                  className="flex flex-wrap items-center gap-3 border-b border-divider py-2"
                >
                  <span className="text-sm">
                    {d.title} · v{d.version}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="press"
                    disabled={proof.isPending}
                    onClick={() =>
                      preparedPdf?.resourceId === d.resourceId
                        ? downloadPdf()
                        : proof.mutate(d.resourceId)
                    }
                  >
                    {proof.isPending && proof.variables === d.resourceId ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                    {proof.isPending && proof.variables === d.resourceId ? "Preparing PDF…" : preparedPdf?.resourceId === d.resourceId ? "Download PDF" : "Prepare PDF"}
                  </Button>
                </div>
              ))}
            {proof.isError && <p role="alert" className="text-sm text-destructive">{proof.error.message}</p>}
            {preparedPdf && !proof.isPending && <div role="status" className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
              <span>PDF ready</span>
              <Button variant="outline" className="press" onClick={downloadPdf}><Download className="size-4" />Download PDF</Button>
            </div>}
          </div>
        )}
      </section>

      <Sheet open={!!review} onOpenChange={(open) => !open && !remind.isPending && setReview(null)}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn(
            "w-full sm:max-w-lg overflow-y-auto",
            isMobile ? "paper-surface" : "bg-popover",
          )}
        >
          <SheetHeader>
            <SheetTitle>Review reminders</SheetTitle>
            <SheetDescription>
              {review?.length ?? 0} outstanding acknowledgements. Guardians receive reminders for
              minor athletes.
            </SheetDescription>
          </SheetHeader>
          <ul className="my-4 divide-y divide-divider">
            {review?.map((r) => (
              <li key={r.id} className="py-3">
                <p>{r.name}</p>
                <p className="text-sm text-text-secondary">
                  {r.document} · v{r.version}
                </p>
              </li>
            ))}
          </ul>
          <Button
            className="press"
            disabled={remind.isPending || !review?.length}
            onClick={() => review && remind.mutate(review)}
          >
            {remind.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Bell className="size-4" />
            )}
            Send reminders
          </Button>
        </SheetContent>
      </Sheet>
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
