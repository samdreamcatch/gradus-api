import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ClubTable } from "@/components/org-admin/club-table";
import { ClubGridToolbar } from "@/components/org-admin/club-grid-toolbar";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2, Upload } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NoSportsCard, SportFilter, useOrgId } from "@/components/org-admin/org-shared";
import { parseCsvObjects, downloadCsv, toCsv } from "@/lib/csv";
import { listOrgLevels } from "@/lib/org-content.functions";
import {
  archiveOrgTemplate,
  deployOrgTemplate,
  importOrgTemplates,
  listOrgTemplates,
  saveOrgTemplate,
  type OrgTemplateRow,
} from "@/lib/org-templates.functions";
import { groupTemplateCsv, type TemplateDraft, type TemplateMoveDraft } from "@/lib/org-templates";

export const Route = createFileRoute("/_authenticated/org-admin/templates")({
  head: () => ({
    meta: [
      { title: "Template plans · Gradus Club" },
      {
        name: "description",
        content: "Build club template plans and send them to coaches by sport and level.",
      },
      { property: "og:title", content: "Template plans · Gradus Club" },
      {
        property: "og:description",
        content: "Build club template plans and send them to coaches by sport and level.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrgTemplatesPage,
});

const emptyMove = (): TemplateMoveDraft => ({
  name: "",
  cue: "",
  why: "",
  targetKind: "reps",
  targetValue: 10,
});

function OrgTemplatesPage() {
  const { orgId } = useOrgId();
  const listFn = useServerFn(listOrgTemplates);
  const levelsFn = useServerFn(listOrgLevels);
  const archiveFn = useServerFn(archiveOrgTemplate);
  const deployFn = useServerFn(deployOrgTemplate);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["org-templates", orgId],
    queryFn: () => listFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
  });
  const levelsQ = useQuery({
    queryKey: ["org-levels", orgId],
    queryFn: () => levelsFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
  });
  const sports = q.data?.sports ?? [];
  const [sport, setSport] = useState("");
  useEffect(() => {
    if (!sport && sports.length) setSport(sports[0]);
  }, [sports, sport]);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<OrgTemplateRow | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deploying, setDeploying] = useState<OrgTemplateRow | null>(null);

  const levels = useMemo(
    () => (levelsQ.data?.levels ?? []).filter((l) => l.sport === sport && !l.archived),
    [levelsQ.data, sport],
  );
  const levelLabel = (k: string) => levels.find((l) => l.levelKey === k)?.label ?? k;
  const rows = (q.data?.templates ?? []).filter(
    (t) => t.sport === sport && (showArchived || !t.archived),
  );
  const refresh = () => qc.invalidateQueries({ queryKey: ["org-templates", orgId] });

  const archive = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) =>
      archiveFn({ data: { organizationId: orgId!, ...v } }),
    onSuccess: (_r, v) => {
      toast.success(v.archived ? "Template archived" : "Template restored");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });
  const deploy = useMutation({
    mutationFn: (id: string) => deployFn({ data: { organizationId: orgId!, id } }),
    onSuccess: (r) => {
      toast.success(
        r.sent
          ? `Sent to ${r.sent} coach${r.sent === 1 ? "" : "es"}`
          : "Every matching coach already has this template",
      );
      setDeploying(null);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't send"),
  });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <PageTitle>Template plans</PageTitle>
      <ClubLibraryNav />
      {q.isPending ? (
        <Loader2 className="size-5 animate-spin text-text-tertiary" />
      ) : !sports.length ? (
        <NoSportsCard />
      ) : (
        <>
          <ClubGridToolbar
            end={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="press"
                  onClick={() => setImportOpen(true)}
                >
                  <Upload className="size-4" /> Import CSV
                </Button>
                <Button size="sm" className="press" onClick={() => setEditing("new")}>
                  <Plus className="size-4" /> New template
                </Button>
              </>
            }
          >
            <SportFilter sports={sports} value={sport} onChange={setSport} />
            <label className="flex items-center gap-2 px-1 text-sm text-text-secondary">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
            </label>
          </ClubGridToolbar>
          {rows.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-text-secondary">
                No template plans for this sport yet.
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <ClubTable>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead>Levels</TableHead>
                    <TableHead className="text-right">Moves</TableHead>
                    <TableHead className="text-right">Coaches</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => (
                    <TableRow key={t.id} className={t.archived ? "opacity-60" : undefined}>
                      <TableCell>
                        <button
                          type="button"
                          className="text-left font-medium text-text-primary press-soft"
                          onClick={() => setEditing(t)}
                        >
                          {t.title}
                        </button>
                        {t.archived && (
                          <Tag tone="muted" className="ml-2">
                            Archived
                          </Tag>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-text-secondary">
                        {t.levelKeys.length ? t.levelKeys.map(levelLabel).join(", ") : "All levels"}
                      </TableCell>
                      <TableCell className="text-right font-mono">{t.moves.length}</TableCell>
                      <TableCell className="text-right font-mono">
                        {t.deployedCount}/{t.eligibleCount}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {!t.archived && (
                          <Button size="sm" className="press" onClick={() => setDeploying(t)}>
                            Send to coaches
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="press"
                          onClick={() => archive.mutate({ id: t.id, archived: !t.archived })}
                        >
                          {t.archived ? "Restore" : "Archive"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ClubTable>
            </Card>
          )}
        </>
      )}

      {editing && (
        <TemplateSheet
          orgId={orgId!}
          sport={sport}
          levels={levels.map((l) => ({ key: l.levelKey, label: l.label }))}
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {importOpen && (
        <ImportSheet
          orgId={orgId!}
          sports={sports}
          onClose={() => setImportOpen(false)}
          onSaved={refresh}
        />
      )}

      <Sheet open={!!deploying} onOpenChange={(o) => !o && setDeploying(null)}>
        <SheetContent side="right" className="bg-popover w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Send "{deploying?.title}" to coaches</SheetTitle>
            <SheetDescription>
              {deploying && deploying.eligibleCount - deploying.deployedCount > 0
                ? `${deploying.eligibleCount - deploying.deployedCount} coach${deploying.eligibleCount - deploying.deployedCount === 1 ? "" : "es"} who teach ${deploying.levelKeys.length ? "these levels" : "this sport"} will get a copy in their templates. Coaches who already have it keep their own version.`
                : "Every coach who teaches these levels already has this template."}
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <Button
              className="w-full press"
              disabled={
                deploy.isPending ||
                !deploying ||
                deploying.eligibleCount - deploying.deployedCount <= 0
              }
              onClick={() => deploying && deploy.mutate(deploying.id)}
            >
              {deploy.isPending ? "Sending…" : "Send"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TemplateSheet({
  orgId,
  sport,
  levels,
  template,
  onClose,
  onSaved,
}: {
  orgId: string;
  sport: string;
  levels: { key: string; label: string }[];
  template: OrgTemplateRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const saveFn = useServerFn(saveOrgTemplate);
  const [title, setTitle] = useState(template?.title ?? "");
  const [notes, setNotes] = useState(template?.notes ?? "");
  const [levelKeys, setLevelKeys] = useState<string[]>(template?.levelKeys ?? []);
  const [moves, setMoves] = useState<TemplateMoveDraft[]>(
    template?.moves.length ? template.moves : [emptyMove()],
  );
  const setMove = (i: number, p: Partial<TemplateMoveDraft>) =>
    setMoves((m) => m.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const swap = (i: number, j: number) =>
    setMoves((m) => {
      const n = [...m];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const valid = title.trim() && moves.some((m) => m.name.trim());
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          organizationId: orgId,
          id: template?.id,
          template: {
            title,
            sport: template?.sport ?? sport,
            levelKeys,
            notes,
            moves: moves.filter((m) => m.name.trim()),
          },
        },
      }),
    onSuccess: () => {
      toast.success("Template saved");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="bg-popover w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{template ? "Edit template" : "New template"}</SheetTitle>
          <SheetDescription>Edits apply to coaches you send it to next.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-title">Title</Label>
            <Input
              id="tpl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Levels</Label>
            <div className="flex flex-wrap gap-3">
              {levels.map((l) => (
                <label key={l.key} className="flex min-h-11 items-center gap-2 text-sm">
                  <Checkbox
                    checked={levelKeys.includes(l.key)}
                    onCheckedChange={(c) =>
                      setLevelKeys((k) => (c ? [...k, l.key] : k.filter((x) => x !== l.key)))
                    }
                  />
                  {l.label}
                </label>
              ))}
            </div>
            <p className="text-meta text-text-tertiary">
              None selected sends to every coach of this sport.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-notes">Notes for coaches</Label>
            <Textarea
              id="tpl-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-3">
            <Label>Moves</Label>
            {moves.map((m, i) => (
              <Card key={i}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={`Move ${i + 1} name`}
                      placeholder="Move name"
                      value={m.name}
                      onChange={(e) => setMove(i, { name: e.target.value })}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="press"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => swap(i, i - 1)}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="press"
                      aria-label="Move down"
                      disabled={i === moves.length - 1}
                      onClick={() => swap(i, i + 1)}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="press"
                      aria-label="Remove move"
                      disabled={moves.length === 1}
                      onClick={() => setMoves((x) => x.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <Input
                    placeholder="Cue (optional)"
                    value={m.cue}
                    onChange={(e) => setMove(i, { cue: e.target.value })}
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="Target"
                      type="number"
                      min={1}
                      className="w-24 font-mono"
                      value={m.targetValue}
                      onChange={(e) => setMove(i, { targetValue: Number(e.target.value) || 1 })}
                    />
                    <SegmentedToggle
                      value={m.targetKind}
                      onChange={(v) => setMove(i, { targetKind: v })}
                      options={[
                        { key: "reps", label: "Reps" },
                        { key: "minutes", label: "Minutes" },
                      ]}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
            <Button
              variant="outline"
              className="press"
              onClick={() => setMoves((m) => [...m, emptyMove()])}
            >
              <Plus className="size-4" /> Add move
            </Button>
          </div>
          <Button
            className="w-full press"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save template"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ImportSheet({
  orgId,
  sports,
  onClose,
  onSaved,
}: {
  orgId: string;
  sports: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const importFn = useServerFn(importOrgTemplates);
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ templates: TemplateDraft[]; errors: string[] } | null>(
    null,
  );
  const save = useMutation({
    mutationFn: () => importFn({ data: { organizationId: orgId, templates: parsed!.templates } }),
    onSuccess: (r) => {
      toast.success(`Imported ${r.count} template${r.count === 1 ? "" : "s"}`);
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't import"),
  });
  const sample = () =>
    downloadCsv(
      "template-plans-sample.csv",
      toCsv(
        ["title", "sport", "levels", "notes", "move", "cue", "why", "target_kind", "target"],
        [
          [
            "Warm up",
            sports[0] ?? "",
            "",
            "Before every lesson",
            "Forward crossovers",
            "Deep knees",
            "",
            "reps",
            10,
          ],
          ["Warm up", sports[0] ?? "", "", "", "Spirals", "", "", "minutes", 3],
        ],
      ),
    );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="bg-popover w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Import template plans</SheetTitle>
          <SheetDescription>
            One row per move. Rows with the same title and sport become one template.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          <div className="flex gap-2">
            <Button className="press" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> Choose CSV
            </Button>
            <Button variant="ghost" className="press" onClick={sample}>
              Download sample
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setParsed(groupTemplateCsv(parseCsvObjects(await f.text()), sports));
            }}
          />
          {parsed && (
            <>
              {parsed.errors.length > 0 && (
                <Card>
                  <CardContent className="space-y-1 p-3 text-sm text-destructive">
                    {parsed.errors.map((er) => (
                      <p key={er}>{er}</p>
                    ))}
                  </CardContent>
                </Card>
              )}
              <ClubTable>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead>Sport</TableHead>
                    <TableHead className="text-right">Moves</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.templates.map((t) => (
                    <TableRow key={`${t.sport}-${t.title}`}>
                      <TableCell>{t.title}</TableCell>
                      <TableCell className="text-sm text-text-secondary">{t.sport}</TableCell>
                      <TableCell className="text-right font-mono">{t.moves.length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ClubTable>
              <Button
                className="w-full press"
                disabled={!parsed.templates.length || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending
                  ? "Importing…"
                  : `Import ${parsed.templates.length} template${parsed.templates.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
