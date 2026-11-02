import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ClubTable } from "@/components/org-admin/club-table";
import { ClubGridToolbar } from "@/components/org-admin/club-grid-toolbar";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus } from "lucide-react";
import { PageTitle } from "@/components/page-title";
import { ClubLibraryNav } from "@/components/org-admin/club-library-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
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
import { listOrgLevels, saveOrgLevels } from "@/lib/org-content.functions";

export const Route = createFileRoute("/_authenticated/org-admin/levels")({
  head: () => ({ meta: [
    { title: "Levels · Gradus Club" },
    { name: "description", content: "Club sport levels and coach practice expectations." },
    { property: "og:title", content: "Levels · Gradus Club" },
    { property: "og:description", content: "Club sport levels and coach practice expectations." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: OrgLevelsPage,
});

type Draft = {
  levelKey?: string;
  label: string;
  hours: string;
  isCustom: boolean;
  archived: boolean;
};

function OrgLevelsPage() {
  const { orgId } = useOrgId();
  const listFn = useServerFn(listOrgLevels);
  const saveFn = useServerFn(saveOrgLevels);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["org-levels", orgId],
    queryFn: () => listFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
  });
  const sports = q.data?.sports ?? [];
  const [sport, setSport] = useState("");
  useEffect(() => {
    if (!sport && sports.length) setSport(sports[0]);
  }, [sports, sport]);
  const [rows, setRows] = useState<Draft[]>([]);
  useEffect(() => {
    setRows(
      (q.data?.levels ?? [])
        .filter((l) => l.sport === sport)
        .map((l) => ({
          levelKey: l.levelKey,
          label: l.label,
          hours: String(l.practiceHoursPerWeek),
          isCustom: l.isCustom,
          archived: l.archived,
        })),
    );
  }, [q.data, sport]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          organizationId: orgId!,
          sport,
          levels: rows
            .filter((r) => r.label.trim())
            .map((r) => ({
              levelKey: r.levelKey,
              label: r.label.trim(),
              practiceHoursPerWeek: Math.max(0, Number(r.hours) || 0),
              archived: r.archived,
            })),
        },
      }),
    onSuccess: () => {
      toast.success("Levels saved for your club");
      qc.invalidateQueries({ queryKey: ["org-levels", orgId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });

  const set = (i: number, patch: Partial<Draft>) =>
    setRows((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setRows((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const n = [...xs];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <PageTitle>Levels</PageTitle>
      <ClubLibraryNav />
      {q.isPending ? (
        <Loader2 className="size-5 animate-spin text-text-tertiary" />
      ) : !sports.length ? (
        <NoSportsCard />
      ) : (
        <>
          <ClubGridToolbar>
            <SportFilter sports={sports} value={sport} onChange={setSport} />
          </ClubGridToolbar>
          <Card>
            <CardHeader>
              <CardTitle>{sportDisplayLabel(sport)}</CardTitle>
              <p className="text-sm text-text-secondary">
                Coaches in your club start with these practice hours. A coach can still change
                their own.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <ClubTable>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16" />
                    <TableHead>Level</TableHead>
                    <TableHead className="w-36">Practice hrs/week</TableHead>
                    <TableHead className="w-28">Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={r.levelKey ?? `new-${i}`} className={r.archived ? "opacity-60" : undefined}>
                      <TableCell>
                        <div className="flex">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Move up"
                            onClick={() => move(i, -1)}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Move down"
                            onClick={() => move(i, 1)}
                          >
                            <ArrowDown />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input
                            className="h-8"
                            value={r.label}
                            onChange={(e) => set(i, { label: e.target.value })}
                          />
                          {r.isCustom && <Tag tone="accent">Club</Tag>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-24"
                          inputMode="decimal"
                          value={r.hours}
                          onChange={(e) => set(i, { hours: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={!r.archived}
                          onCheckedChange={(v) => set(i, { archived: v !== true })}
                          aria-label="Active"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ClubTable>
              <div className="flex items-center gap-2 border-t border-divider p-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRows((xs) => [...xs, { label: "", hours: "3", isCustom: true, archived: false }])
                  }
                >
                  <Plus /> Add club level
                </Button>
                <div className="flex-1" />
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save levels"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
