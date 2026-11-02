import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ClubTable } from "@/components/org-admin/club-table";
import { ClubGridToolbar } from "@/components/org-admin/club-grid-toolbar";
import { ClubDataGrid, useClubGrid, type ClubColumn } from "@/components/org-admin/club-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { PageTitle } from "@/components/page-title";
import { ClubLibraryNav } from "@/components/org-admin/club-library-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NoSportsCard, SportFilter, useOrgId } from "@/components/org-admin/org-shared";
import { parseCsvObjects } from "@/lib/csv";
import {
  importOrgMoves,
  listOrgMoves,
  updateOrgMoves,
  type OrgMoveRow,
} from "@/lib/org-content.functions";

export const Route = createFileRoute("/_authenticated/org-admin/moves")({
  head: () => ({
    meta: [
      { title: "Moves · Gradus Club" },
      { name: "description", content: "Club move library and sport-specific coaching content." },
      { property: "og:title", content: "Moves · Gradus Club" },
      {
        property: "og:description",
        content: "Club move library and sport-specific coaching content.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrgMovesPage,
});

type Patch = {
  name?: string;
  category?: string;
  description?: string;
  cue?: string;
  why?: string;
  defaultTargetKind?: "reps" | "mins";
  defaultTargetValue?: number;
  archived?: boolean;
};

function OrgMovesPage() {
  const { orgId } = useOrgId();
  const listFn = useServerFn(listOrgMoves);
  const updateFn = useServerFn(updateOrgMoves);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["org-moves", orgId],
    queryFn: () => listFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
  });
  const sports = q.data?.sports ?? [];
  const [sport, setSport] = useState("");
  useEffect(() => {
    if (!sport && sports.length) setSport(sports[0]);
  }, [sports, sport]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<OrgMoveRow | null>(null);
  const [bulkEdit, setBulkEdit] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.moves ?? []).filter(
      (m) =>
        m.sport === sport &&
        (showArchived || !m.archived) &&
        (!s || m.name.toLowerCase().includes(s) || m.category.toLowerCase().includes(s)),
    );
  }, [q.data, sport, search, showArchived]);

  useEffect(() => setSelected(new Set()), [sport]);
  const columns: ClubColumn<OrgMoveRow>[] = [
    {
      key: "name",
      label: "Move",
      sortValue: (m) => m.name,
      className: "min-w-56",
      render: (m) => (
        <span className="flex items-start gap-3">
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox
              aria-label={`Select ${m.name}`}
              checked={selected.has(m.key)}
              onCheckedChange={(v) => toggle(m.key, v === true)}
            />
          </span>
          <span className={m.archived ? "opacity-60" : undefined}>
            <span className="block">{m.name}</span>
            {m.cue && <span className="block text-xs font-normal text-text-secondary">{m.cue}</span>}
          </span>
        </span>
      ),
    },
    { key: "category", label: "Category", sortValue: (m) => m.category, groupValue: (m) => m.category, render: (m) => m.category },
    {
      key: "target",
      label: "Target",
      sortValue: (m) => m.defaultTargetValue,
      className: "whitespace-nowrap text-text-secondary",
      render: (m) => `${m.defaultTargetValue} ${m.defaultTargetKind}`,
    },
    {
      key: "source",
      label: "From",
      sortValue: (m) => m.source,
      groupValue: (m) => (m.source === "club" ? "Club" : "Gradus"),
      render: (m) => (
        <span className="flex flex-wrap gap-1">
          <Tag tone={m.source === "club" ? "accent" : "muted"}>{m.source === "club" ? "Club" : "Gradus"}</Tag>
          {m.edited && <Tag tone="muted">Edited</Tag>}
          {m.archived && <Tag tone="muted">Archived</Tag>}
        </span>
      ),
    },
    { key: "description", label: "Description", defaultHidden: true, className: "min-w-64 whitespace-normal text-text-secondary", render: (m) => m.description || "—" },
  ];
  const grid = useClubGrid("moves", columns, rows, { group: "category" });

  const update = useMutation({
    mutationFn: (v: { keys: string[]; patch: Patch }) =>
      updateFn({ data: { organizationId: orgId!, keys: v.keys, patch: v.patch } }),
    onSuccess: (r) => {
      toast.success(`Updated ${r.count} move${r.count === 1 ? "" : "s"} for your club`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["org-moves", orgId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });

  const toggle = (key: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  const sel = Array.from(selected);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl">
      <PageTitle>Move library</PageTitle>
      <ClubLibraryNav />
      {q.isPending ? (
        <Loader2 className="size-5 animate-spin text-text-tertiary" />
      ) : !sports.length ? (
        <NoSportsCard />
      ) : (
        <>
          <ClubGridToolbar
            search={search}
            onSearchChange={setSearch}
            searchLabel="Search moves"
            activeFilters={search ? 1 : 0}
            onClear={() => setSearch("")}
            end={
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload /> Bulk upload (CSV)
              </Button>
            }
          >
            <SportFilter sports={sports} value={sport} onChange={setSport} />
            <label className="flex items-center gap-2 px-1 text-sm text-text-secondary">
              <Switch checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} />
              Show archived
            </label>
            <span className="mx-1 h-6 w-px bg-divider" aria-hidden />
            {grid.menu}
          </ClubGridToolbar>

          {sel.length > 0 && (
            <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-popover p-2 shadow-card">
              <span className="px-2 text-sm text-text-primary">{sel.length} selected</span>
              <Button size="sm" variant="outline" onClick={() => setBulkEdit(true)}>
                Bulk edit
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmArchive(true)}>
                Archive
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => update.mutate({ keys: sel, patch: { archived: false } })}
              >
                Restore
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          )}

          <ClubDataGrid
            grid={grid}
            rowKey={(m) => m.key}
            onRowClick={setEditing}
            rowLabel={(m) => m.name}
            filtered={!!search || !showArchived}
            onClear={() => setSearch("")}
            empty="No moves for this sport yet."
          />
        </>
      )}

      <EditMoveSheet
        move={editing}
        onClose={() => setEditing(null)}
        onSave={(patch) => {
          if (editing) update.mutate({ keys: [editing.key], patch });
          setEditing(null);
        }}
      />
      <BulkEditSheet
        open={bulkEdit}
        count={sel.length}
        onClose={() => setBulkEdit(false)}
        onSave={(patch) => {
          update.mutate({ keys: sel, patch });
          setBulkEdit(false);
        }}
      />
      {orgId && (
        <ImportSheet
          orgId={orgId}
          sports={sports}
          open={importOpen}
          onOpenChange={setImportOpen}
          onDone={() => qc.invalidateQueries({ queryKey: ["org-moves", orgId] })}
        />
      )}
      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {sel.length} moves?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll be removed from every club coach's library. Plans that already use them keep
              working. You can restore them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => update.mutate({ keys: sel, patch: { archived: true } })}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TargetFields({
  kind,
  value,
  onKind,
  onValue,
}: {
  kind: "reps" | "mins";
  value: string;
  onKind: (k: "reps" | "mins") => void;
  onValue: (v: string) => void;
}) {
  return (
    <div className="flex items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="mv-target">Default target</Label>
        <Input
          id="mv-target"
          className="w-24"
          inputMode="decimal"
          value={value}
          onChange={(e) => onValue(e.target.value)}
        />
      </div>
      <SegmentedToggle
        value={kind}
        onChange={onKind}
        options={[
          { key: "reps", label: "Reps" },
          { key: "mins", label: "Mins" },
        ]}
      />
    </div>
  );
}

function EditMoveSheet({
  move,
  onClose,
  onSave,
}: {
  move: OrgMoveRow | null;
  onClose: () => void;
  onSave: (p: Patch) => void;
}) {
  const [f, setF] = useState({ name: "", category: "", description: "", cue: "", why: "" });
  const [kind, setKind] = useState<"reps" | "mins">("reps");
  const [value, setValue] = useState("");
  useEffect(() => {
    if (!move) return;
    setF({
      name: move.name,
      category: move.category,
      description: move.description,
      cue: move.cue,
      why: move.why,
    });
    setKind(move.defaultTargetKind);
    setValue(String(move.defaultTargetValue));
  }, [move]);
  const num = Number(value);
  return (
    <Sheet open={!!move} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit move</SheetTitle>
          {move?.source === "gradus" && (
            <SheetDescription>
              Your club's version replaces the Gradus default for all your coaches.
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="mt-6 space-y-4">
          {(["name", "category"] as const).map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`mv-${k}`}>{k === "name" ? "Name" : "Category"}</Label>
              <Input
                id={`mv-${k}`}
                value={f[k]}
                onChange={(e) => setF({ ...f, [k]: e.target.value })}
              />
            </div>
          ))}
          {(["cue", "why", "description"] as const).map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`mv-${k}`}>
                {k === "cue" ? "Cue" : k === "why" ? "Why" : "Description"}
              </Label>
              <Textarea
                id={`mv-${k}`}
                rows={2}
                value={f[k]}
                onChange={(e) => setF({ ...f, [k]: e.target.value })}
              />
            </div>
          ))}
          <TargetFields kind={kind} value={value} onKind={setKind} onValue={setValue} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!f.name.trim() || !f.category.trim() || !Number.isFinite(num) || num < 0}
              onClick={() => onSave({ ...f, defaultTargetKind: kind, defaultTargetValue: num })}
            >
              Save
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BulkEditSheet({
  open,
  count,
  onClose,
  onSave,
}: {
  open: boolean;
  count: number;
  onClose: () => void;
  onSave: (p: Patch) => void;
}) {
  const [category, setCategory] = useState("");
  const [setTarget, setSetTarget] = useState(false);
  const [kind, setKind] = useState<"reps" | "mins">("reps");
  const [value, setValue] = useState("10");
  useEffect(() => {
    if (open) {
      setCategory("");
      setSetTarget(false);
    }
  }, [open]);
  const num = Number(value);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Bulk edit {count} moves</SheetTitle>
          <SheetDescription>Only the fields you fill in change.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-cat">Move to category</Label>
            <Input
              id="bulk-cat"
              placeholder="Leave empty to keep"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <Checkbox checked={setTarget} onCheckedChange={(v) => setSetTarget(v === true)} />
            Change default target
          </label>
          {setTarget && (
            <TargetFields kind={kind} value={value} onKind={setKind} onValue={setValue} />
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={(!category.trim() && !setTarget) || (setTarget && !(num >= 0))}
              onClick={() =>
                onSave({
                  ...(category.trim() && { category: category.trim() }),
                  ...(setTarget && { defaultTargetKind: kind, defaultTargetValue: num }),
                })
              }
            >
              Apply
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

type ImportRow = {
  sport: string;
  category: string;
  name: string;
  description: string;
  cue: string;
  why: string;
  defaultTargetKind: "reps" | "mins";
  defaultTargetValue: number;
};

function ImportSheet({
  orgId,
  sports,
  open,
  onOpenChange,
  onDone,
}: {
  orgId: string;
  sports: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const importFn = useServerFn(importOrgMoves);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setRows([]);
      setProblems([]);
    }
  }, [open]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const objs = parseCsvObjects(await file.text());
    const ok: ImportRow[] = [];
    const bad: string[] = [];
    objs.forEach((o, i) => {
      const sport = (o.sport ?? "").toLowerCase().replace(/[\s&]+/g, "_");
      const kind = (o.target_kind ?? o.unit ?? "reps").toLowerCase().startsWith("min")
        ? "mins"
        : "reps";
      const value = Number(o.target ?? o.target_value ?? 10);
      if (!sports.includes(sport)) bad.push(`Row ${i + 2}: sport "${o.sport}" isn't in your club`);
      else if (!o.name || !o.category) bad.push(`Row ${i + 2}: needs a name and category`);
      else
        ok.push({
          sport,
          category: o.category,
          name: o.name,
          description: o.description ?? "",
          cue: o.cue ?? "",
          why: o.why ?? "",
          defaultTargetKind: kind,
          defaultTargetValue: Number.isFinite(value) ? value : 10,
        });
    });
    setRows(ok);
    setProblems(bad);
  };

  const run = async () => {
    setBusy(true);
    try {
      const r = await importFn({ data: { organizationId: orgId, moves: rows } });
      toast.success(
        `${r.created} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ""}`,
      );
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Bulk upload moves</SheetTitle>
          <SheetDescription>
            CSV columns: sport, category, name, cue, why, description, target, target_kind (reps or
            mins). A name that matches an existing move in that sport updates it.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <Input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          {problems.length > 0 && (
            <div className="rounded-lg border border-destructive/50 p-3 text-xs text-destructive space-y-1">
              {problems.slice(0, 10).map((p) => (
                <div key={p}>{p}</div>
              ))}
              {problems.length > 10 && <div>…and {problems.length - 10} more</div>}
            </div>
          )}
          {rows.length > 0 && (
            <ClubTable>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 50).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{r.name}</TableCell>
                    <TableCell className="text-sm text-text-secondary">{r.category}</TableCell>
                    <TableCell className="text-sm text-text-secondary">
                      {r.defaultTargetValue} {r.defaultTargetKind}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </ClubTable>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={run} disabled={busy || !rows.length}>
              {busy ? "Saving…" : `Save ${rows.length} moves`}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
