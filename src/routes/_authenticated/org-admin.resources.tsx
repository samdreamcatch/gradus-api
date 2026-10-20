import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageTitle } from "@/components/page-title";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import { Eyebrow } from "@/components/ui/eyebrow";
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
import { sportDisplayLabel } from "@/lib/coach-sports";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  createOrgResourceUploadUrl,
  getResourceAckStatus,
  listOrgResources,
  remindOutstandingAcks,
  saveOrgResource,
  setOrgResourcesArchived,
  setResourceAckRequirement,
  type OrgResourceRow,
} from "@/lib/org-content.functions";

export const Route = createFileRoute("/_authenticated/org-admin/resources")({
  head: () => ({ meta: [{ title: "Resource library · Organization Admin · Gradus" }] }),
  component: OrgResourcesPage,
});

const AUDIENCE_LABEL: Record<string, string> = {
  coach: "Coaches",
  parent: "Parents",
  athlete: "Athletes",
};

function useUploadPdf(orgId: string | undefined) {
  const uploadUrl = useServerFn(createOrgResourceUploadUrl);
  return async (file: File) => {
    if (file.type !== "application/pdf") throw new Error(`${file.name} isn't a PDF.`);
    const signed = await uploadUrl({ data: { organizationId: orgId!, contentType: file.type } });
    const { error } = await supabase.storage
      .from("resource-pdfs")
      .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
    if (error) throw new Error(`Couldn't upload ${file.name}.`);
    return signed.path;
  };
}

function OrgResourcesPage() {
  const { orgId } = useOrgId();
  const listFn = useServerFn(listOrgResources);
  const archiveFn = useServerFn(setOrgResourcesArchived);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["org-resources", orgId],
    queryFn: () => listFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
  });
  const sports = q.data?.sports ?? [];
  const [sport, setSport] = useState("");
  useEffect(() => {
    if (!sport && sports.length) setSport(sports[0]);
  }, [sports, sport]);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<OrgResourceRow | "new" | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [ackFor, setAckFor] = useState<OrgResourceRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<OrgResourceRow | null>(null);

  const rows = useMemo(
    () =>
      (q.data?.resources ?? []).filter(
        (r) => r.sport === sport && (showArchived ? true : !r.archived),
      ),
    [q.data, sport, showArchived],
  );
  const refresh = () => qc.invalidateQueries({ queryKey: ["org-resources", orgId] });

  const archive = useMutation({
    mutationFn: (v: { row: OrgResourceRow; archived: boolean }) =>
      archiveFn({
        data: { organizationId: orgId!, resourceIds: [v.row.id], archived: v.archived },
      }),
    onSuccess: (_r, v) => {
      toast.success(v.archived ? "Archived for your club" : "Restored");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <PageTitle>
        Resource library
      </PageTitle>
      {q.isPending ? (
        <Loader2 className="size-5 animate-spin text-text-tertiary" />
      ) : !sports.length ? (
        <NoSportsCard />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <SportFilter sports={sports} value={sport} onChange={setSport} />
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <Switch checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} />
              Show archived
            </label>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
              <Upload /> Bulk upload
            </Button>
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus /> Add resource
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Acknowledgement</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-text-secondary">
                        No resources for {sportDisplayLabel(sport)} yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((r) => (
                    <TableRow key={r.id} className={r.archived ? "opacity-60" : undefined}>
                      <TableCell>
                        <div className="font-medium text-text-primary">{r.title}</div>
                        {r.description && (
                          <div className="text-xs text-text-secondary line-clamp-2">
                            {r.description}
                          </div>
                        )}
                        {r.reviewState !== "released" && (
                          <div className="text-xs text-text-tertiary mt-1">
                            {r.reviewState === "held"
                              ? "Gradus is reviewing this PDF before members see it."
                              : "Checking the file…"}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Tag tone={r.source === "club" ? "accent" : "muted"}>
                            {r.source === "club" ? "Club" : "Gradus"}
                          </Tag>
                          {r.edited && <Tag tone="muted">Edited</Tag>}
                          {r.archived && <Tag tone="muted">Archived</Tag>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-text-secondary">
                        {r.source !== "club" ? (
                          "—"
                        ) : r.ack ? (
                          <button className="press underline" onClick={() => setAckFor(r)}>
                            {r.ack.done} of {r.ack.total} acknowledged
                          </button>
                        ) : (
                          <button className="press underline" onClick={() => setAckFor(r)}>
                            Not required
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1 whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                        {r.archived ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => archive.mutate({ row: r, archived: false })}
                          >
                            Restore
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setArchiveTarget(r)}>
                            Archive
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {orgId && (
        <>
          <EditResourceSheet
            orgId={orgId}
            sports={sports}
            defaultSport={sport}
            target={editing}
            onClose={() => setEditing(null)}
            onSaved={refresh}
          />
          <BulkUploadSheet
            orgId={orgId}
            sports={sports}
            defaultSport={sport}
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            onSaved={refresh}
          />
          <AckSheet orgId={orgId} row={ackFor} onClose={() => setAckFor(null)} onSaved={refresh} />
        </>
      )}

      <AlertDialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this resource?</AlertDialogTitle>
            <AlertDialogDescription>
              Coaches, parents and athletes in your club won't see "{archiveTarget?.title}"
              anymore. You can restore it any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiveTarget) archive.mutate({ row: archiveTarget, archived: true });
                setArchiveTarget(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SportSelect({
  sports,
  value,
  onChange,
}: {
  sports: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return <SportFilter sports={sports} value={value} onChange={onChange} />;
}

function EditResourceSheet({
  orgId,
  sports,
  defaultSport,
  target,
  onClose,
  onSaved,
}: {
  orgId: string;
  sports: string[];
  defaultSport: string;
  target: OrgResourceRow | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const saveFn = useServerFn(saveOrgResource);
  const upload = useUploadPdf(orgId);
  const isNew = target === "new";
  const row = target && target !== "new" ? target : null;
  const isGradus = row?.source === "gradus";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sport, setSport] = useState(defaultSport);
  const [kind, setKind] = useState<"pdf" | "link">("pdf");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setTitle(row?.title ?? "");
    setDescription(row?.description ?? "");
    setSport(row?.sport ?? defaultSport);
    setKind(row?.kind === "link" ? "link" : "pdf");
    setUrl(row?.externalUrl ?? "");
    setFile(null);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setBusy(true);
    try {
      const storagePath = kind === "pdf" && file ? await upload(file) : undefined;
      const res = await saveFn({
        data: {
          organizationId: orgId,
          id: row?.id,
          sport,
          title: title.trim(),
          description,
          kind: isGradus ? undefined : kind,
          storagePath,
          externalUrl: kind === "link" && url.trim() ? url.trim() : undefined,
        },
      });
      toast.success(
        res.reviewState === "held"
          ? "Saved. Gradus reviews this PDF before members see it, because it has pictures."
          : "Saved for your club",
      );
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isNew ? "Add resource" : "Edit resource"}</SheetTitle>
          {isGradus && (
            <SheetDescription>
              This is a Gradus document. Your edits to the title and description show only for
              your club.
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="mt-6 space-y-4">
          {!isGradus && (
            <div className="space-y-1.5">
              <Label>Sport</Label>
              <div>
                <SportSelect sports={sports} value={sport} onChange={setSport} />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="res-title">Title</Label>
            <Input id="res-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="res-desc">Description</Label>
            <Textarea
              id="res-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {!isGradus && (
            <>
              <SegmentedToggle
                value={kind}
                onChange={(v) => setKind(v as "pdf" | "link")}
                options={[
                  { key: "pdf", label: "PDF" },
                  { key: "link", label: "Link" },
                ]}
              />
              {kind === "pdf" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="res-file">
                    {row?.storagePath ? "Replace PDF (optional)" : "PDF"}
                  </Label>
                  <Input
                    id="res-file"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="res-url">Link</Label>
                  <Input
                    id="res-url"
                    placeholder="https://…"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={
                busy ||
                !title.trim() ||
                (isNew && (kind === "pdf" ? !file : !url.trim()))
              }
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

type BulkItem = { file: File; title: string; sport: string };

function BulkUploadSheet({
  orgId,
  sports,
  defaultSport,
  open,
  onOpenChange,
  onSaved,
}: {
  orgId: string;
  sports: string[];
  defaultSport: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const saveFn = useServerFn(saveOrgResource);
  const upload = useUploadPdf(orgId);
  const [items, setItems] = useState<BulkItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (open) setItems([]);
  }, [open]);

  const run = async () => {
    setBusy(true);
    setProgress(0);
    let ok = 0;
    let held = 0;
    for (const it of items) {
      try {
        const storagePath = await upload(it.file);
        const r = await saveFn({
          data: {
            organizationId: orgId,
            sport: it.sport,
            title: it.title.trim() || it.file.name,
            description: "",
            kind: "pdf",
            storagePath,
          },
        });
        ok++;
        if (r.reviewState === "held") held++;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Couldn't add ${it.file.name}`);
      }
      setProgress((p) => p + 1);
    }
    setBusy(false);
    toast.success(
      `${ok} added${held ? `. Gradus reviews ${held} with pictures before members see them.` : ""}`,
    );
    onSaved();
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Bulk upload</SheetTitle>
          <SheetDescription>Pick several PDFs, then choose a title and sport for each.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <Input
            type="file"
            multiple
            accept="application/pdf"
            disabled={busy}
            onChange={(e) =>
              setItems(
                Array.from(e.target.files ?? []).map((file) => ({
                  file,
                  title: file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "),
                  sport: defaultSport,
                })),
              )
            }
          />
          {items.map((it, i) => (
            <div key={i} className="rounded-lg border border-divider p-3 space-y-2">
              <Eyebrow size="nano" tone="tertiary">
                {it.file.name}
              </Eyebrow>
              <Input
                value={it.title}
                onChange={(e) =>
                  setItems((xs) => xs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                }
              />
              <SportSelect
                sports={sports}
                value={it.sport}
                onChange={(v) =>
                  setItems((xs) => xs.map((x, j) => (j === i ? { ...x, sport: v } : x)))
                }
              />
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={run} disabled={busy || !items.length}>
              {busy ? `Uploading ${progress}/${items.length}…` : `Add ${items.length || ""}`}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AckSheet({
  orgId,
  row,
  onClose,
  onSaved,
}: {
  orgId: string;
  row: OrgResourceRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const statusFn = useServerFn(getResourceAckStatus);
  const setFn = useServerFn(setResourceAckRequirement);
  const remindFn = useServerFn(remindOutstandingAcks);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["org-ack", row?.id],
    queryFn: () => statusFn({ data: { organizationId: orgId, resourceId: row!.id } }),
    enabled: !!row,
  });
  const [audiences, setAudiences] = useState<string[]>([]);
  const [askAgain, setAskAgain] = useState(false);
  useEffect(() => {
    setAudiences(q.data?.requirement?.audiences ?? []);
    setAskAgain(false);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      setFn({
        data: {
          organizationId: orgId,
          resourceId: row!.id,
          audiences: audiences as ("coach" | "parent" | "athlete")[],
          askAgain,
          notify: true,
        },
      }),
    onSuccess: (r) => {
      toast.success(r.notified ? `Saved. Notified ${r.notified} people.` : "Saved");
      qc.invalidateQueries({ queryKey: ["org-ack", row?.id] });
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });
  const remind = useMutation({
    mutationFn: () => remindFn({ data: { organizationId: orgId, resourceId: row!.id } }),
    onSuccess: (r) => toast.success(`Reminded ${r.notified} people`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't send"),
  });

  const signers = q.data?.signers ?? [];
  const exportCsv = () => {
    const csv = toCsv(
      ["Name", "Role", "For athlete", "Status", "Signed by", "Acknowledged at", "Version"],
      signers.map((s) => [
        s.name,
        s.role,
        s.forAthleteName ?? "",
        s.acknowledgedAt ? "Acknowledged" : "Outstanding",
        s.signedBy ?? "",
        s.acknowledgedAt ?? "",
        q.data?.requirement?.version ?? "",
      ]),
    );
    downloadCsv(`${row?.title ?? "acknowledgements"}.csv`, csv);
  };

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Require acknowledgement</SheetTitle>
          <SheetDescription>{row?.title}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <Eyebrow size="nano" tone="tertiary">
              Who must acknowledge
            </Eyebrow>
            {(["coach", "parent", "athlete"] as const).map((a) => (
              <label key={a} className="flex items-center gap-2 text-sm text-text-primary">
                <Checkbox
                  checked={audiences.includes(a)}
                  onCheckedChange={(v) =>
                    setAudiences((xs) => (v ? [...xs, a] : xs.filter((x) => x !== a)))
                  }
                />
                {AUDIENCE_LABEL[a]}
              </label>
            ))}
            <p className="text-xs text-text-secondary">
              For athletes under 18, a parent or guardian acknowledges for them.
            </p>
            {q.data?.requirement && (
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <Checkbox checked={askAgain} onCheckedChange={(v) => setAskAgain(v === true)} />
                Ask everyone to acknowledge again (new version)
              </label>
            )}
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save and notify"}
              </Button>
            </div>
          </div>

          {q.data?.requirement && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Eyebrow size="nano" tone="tertiary">
                  Sign-offs · version {q.data.requirement.version}
                </Eyebrow>
                <div className="flex-1" />
                <Button variant="outline" size="sm" onClick={exportCsv}>
                  Export CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => remind.mutate()}
                  disabled={remind.isPending}
                >
                  Remind outstanding
                </Button>
              </div>
              <Table>
                <TableBody>
                  {signers.map((s) => (
                    <TableRow key={s.key}>
                      <TableCell>
                        <div className="text-sm text-text-primary">{s.name || "—"}</div>
                        <div className="text-xs text-text-tertiary">
                          {AUDIENCE_LABEL[s.role]}
                          {s.forAthleteId && " · guardian signs"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {s.acknowledgedAt ? (
                          <span className="text-text-secondary">
                            {new Date(s.acknowledgedAt).toLocaleString()}
                            {s.forAthleteId && s.signedBy ? ` · ${s.signedBy}` : ""}
                          </span>
                        ) : (
                          <Tag tone="muted">Outstanding</Tag>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!signers.length && (
                    <TableRow>
                      <TableCell className="text-sm text-text-secondary">
                        No one in your club matches yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {(q.data.history ?? []).length > 0 && (
                <p className="text-xs text-text-tertiary">
                  {q.data.history.length} sign-offs on earlier versions are kept in the history.
                </p>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
