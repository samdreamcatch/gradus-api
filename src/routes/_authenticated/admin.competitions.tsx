import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeSVG } from "qrcode.react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { ShareInviteButton } from "@/components/share/share-invite-button";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tag } from "@/components/ui/tag";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  listCompetitions,
  upsertCompetition,
  refreshCompetitionNow,
  setCompetitionActive,
  type AdminCompetition,
} from "@/lib/competitions-admin.functions";

export const Route = createFileRoute("/_authenticated/admin/competitions")({
  head: () => ({
    meta: [
      { title: "Competitions — Gradus Admin" },
      { name: "description", content: "Create and manage live competition boards." },
      { property: "og:title", content: "Competitions — Gradus Admin" },
      { property: "og:description", content: "Create and manage live competition boards." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminCompetitions,
});

function boardUrl(slug: string) {
  const origin = typeof window === "undefined" ? "https://gradus.training" : window.location.origin;
  return `${origin}/board/${slug}`;
}

function openWallDisplay(slug: string) {
  window.open(
    `${boardUrl(slug)}/wall`,
    "gradus-wall",
    "noopener,noreferrer,popup=yes,width=1080,height=1920",
  );
}

async function copyBoardLink(slug: string) {
  try {
    await navigator.clipboard.writeText(boardUrl(slug));
    toast.success("Board link copied", { description: boardUrl(slug) });
  } catch {
    toast.success("Board link", { description: boardUrl(slug) });
  }
}

function AdminCompetitions() {
  const qc = useQueryClient();
  const list = useServerFn(listCompetitions);
  const upsert = useServerFn(upsertCompetition);
  const refresh = useServerFn(refreshCompetitionNow);
  const setActive = useServerFn(setCompetitionActive);

  const [source, setSource] = useState("");
  const [slug, setSlug] = useState("");
  const [qrFor, setQrFor] = useState<AdminCompetition | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-competitions"],
    queryFn: () => list(),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin-competitions"] });

  const addMutation = useMutation({
    mutationFn: () => upsert({ data: { source, slug: slug || undefined } }),
    onSuccess: (res) => {
      setSource("");
      setSlug("");
      invalidate();
      toast.success(`Board live at /board/${res.slug}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refreshMutation = useMutation({
    mutationFn: (id: string) => refresh({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Refreshed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeMutation = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => setActive({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <header>
        <Eyebrow size="small" tone="accent-ink">
          Internal
        </Eyebrow>
        <h1 className="font-display text-h2 text-text-primary">Competitions</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Add a US Figure Skating event to publish a live board and QR code.
        </p>
      </header>

      <Card variant="section" className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="source">IJS event id or results URL</Label>
            <Input
              id="source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="36666"
              className="focus-input"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="slug">Custom board link (optional)</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="skate-detroit-2026"
              className="focus-input"
            />
            <p className="text-meta text-text-tertiary break-all">
              {slug.trim()
                ? boardUrl(slug.trim())
                : "Leave blank and we'll create one from the event name."}
            </p>
          </div>
        </div>
        <Button
          type="button"
          disabled={!source.trim() || addMutation.isPending}
          onClick={() => addMutation.mutate()}
        >
          {addMutation.isPending ? "Reading event…" : "Add competition"}
        </Button>
      </Card>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (data ?? []).length === 0 ? (
        <Card variant="hero">
          <p className="text-sm text-text-secondary">No competitions yet.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {(data ?? []).map((c) => (
            <Card key={c.id} variant="row" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-display text-base text-text-primary">{c.name}</p>
                {c.active ? (
                  <Tag size="caption" tone="accent">
                    published
                  </Tag>
                ) : (
                  <Tag size="caption">archived</Tag>
                )}
              </div>
              <p className="font-mono text-xs text-text-tertiary">
                /board/{c.slug} · {c.datesLabel} · {c.location}
              </p>
              <p className="font-mono text-xs text-text-tertiary">
                {c.generatedAt
                  ? `updated ${new Date(c.generatedAt).toLocaleString()} · ${c.fetchCount} fetches`
                  : "never refreshed"}
                {c.rinks.length ? ` · ${c.rinks.join(", ")}` : ""}
              </p>
              {c.error ? <p className="text-xs text-destructive">{c.error}</p> : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => refreshMutation.mutate(c.id)}
                  disabled={refreshMutation.isPending}
                >
                  Refresh now
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setQrFor(c)}>
                  QR &amp; link
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => copyBoardLink(c.slug)}
                >
                  Copy link
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => openWallDisplay(c.slug)}
                >
                  Wall display
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => activeMutation.mutate({ id: c.id, active: !c.active })}
                >
                  {c.active ? "Archive" : "Publish"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={!!qrFor} onOpenChange={(open) => !open && setQrFor(null)}>
        <SheetContent side="bottom" className="paper-surface">
          <SheetHeader>
            <SheetTitle>{qrFor?.name}</SheetTitle>
            <SheetDescription>
              Print the QR on the rink sign, or share the direct link.
            </SheetDescription>
          </SheetHeader>
          {qrFor ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="rounded-2xl border border-divider bg-card p-4">
                <QRCodeSVG value={boardUrl(qrFor.slug)} size={220} />
              </div>
              <p className="w-full rounded-md border border-divider bg-elevated px-3 py-2 text-center font-mono text-xs break-all text-text-secondary">
                {boardUrl(qrFor.slug)}
              </p>
              <div className="flex w-full flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => copyBoardLink(qrFor.slug)}
                >
                  <Copy className="size-4" aria-hidden /> Copy link
                </Button>
                <ShareInviteButton
                  url={boardUrl(qrFor.slug)}
                  title={qrFor.name}
                  text={`Live results board for ${qrFor.name}`}
                  label="Share link"
                  variant="outline"
                  className="flex-1"
                />
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
