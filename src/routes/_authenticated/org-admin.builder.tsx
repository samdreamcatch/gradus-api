import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { ClubPageHeader } from "@/components/org-admin/club-page-header";
import { ClubLibraryNav } from "@/components/org-admin/club-library-nav";
import { PdfBrandingSheet } from "@/components/org-admin/pdf-branding-sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MultiFilterPill } from "@/components/ui/filter-pill";
import { NoSportsCard, SportFilter, useOrgId } from "@/components/org-admin/org-shared";
import { getOrgSports, saveOrgResource } from "@/lib/org-content.functions";
import { buildClubResourcePdf, writeClubResourceDraft } from "@/lib/resource-builder.functions";
import type { BuilderDraft } from "@/lib/resource-builder";

export const Route = createFileRoute("/_authenticated/org-admin/builder")({
  head: () => ({
    meta: [
      { title: "Custom resource builder · Gradus Club" },
      {
        name: "description",
        content: "Write club-branded PDF handouts with AI and add them to your library.",
      },
      { property: "og:title", content: "Custom resource builder · Gradus Club" },
      {
        property: "og:description",
        content: "Write club-branded PDF handouts with AI and add them to your library.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BuilderPage,
});

type Audience = "coaches" | "parents" | "athletes";

function BuilderPage() {
  const { orgId } = useOrgId();
  const sportsFn = useServerFn(getOrgSports);
  const writeFn = useServerFn(writeClubResourceDraft);
  const buildFn = useServerFn(buildClubResourcePdf);
  const saveFn = useServerFn(saveOrgResource);
  const sportsQ = useQuery({
    queryKey: ["org-sports", orgId],
    queryFn: () => sportsFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
  });
  const sports = sportsQ.data?.sports ?? [];
  const [sport, setSport] = useState("");
  useEffect(() => {
    if (!sport && sports.length) setSport(sports[0]);
  }, [sports, sport]);
  const [audience, setAudience] = useState<Audience[]>(["parents"]);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [draft, setDraft] = useState<BuilderDraft | null>(null);
  const [built, setBuilt] = useState<{ path: string; previewUrl: string | null } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const write = useMutation({
    mutationFn: () =>
      writeFn({ data: { organizationId: orgId!, sport, audiences: audience, title, brief } }),
    onSuccess: (d) => {
      setDraft(d);
      setBuilt(null);
      setSavedId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't write a draft"),
  });
  const build = useMutation({
    mutationFn: () => buildFn({ data: { organizationId: orgId!, draft: draft! } }),
    onSuccess: (r) => setBuilt(r),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't build the PDF"),
  });
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          organizationId: orgId!,
          sport,
          title: draft!.title,
          description: draft!.summary,
          kind: "pdf",
          storagePath: built!.path,
        },
      }),
    onSuccess: (r) => {
      setSavedId(r.id);
      toast.success(
        r.reviewState === "held"
          ? "Added. It's waiting for a picture check before coaches see it."
          : "Added to your resource library",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add to the library"),
  });

  const edit = (fn: (d: BuilderDraft) => BuilderDraft) => {
    setDraft((d) => (d ? fn(d) : d));
    setBuilt(null);
    setSavedId(null);
  };
  const setSection = (i: number, p: Partial<BuilderDraft["sections"][number]>) =>
    edit((d) => ({ ...d, sections: d.sections.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const swap = (i: number, j: number) =>
    edit((d) => {
      const n = [...d.sections];
      [n[i], n[j]] = [n[j], n[i]];
      return { ...d, sections: n };
    });

  return (
    <div className="px-4 py-6 md:px-6 md:py-8 space-y-5 max-w-3xl">
      <ClubPageHeader title="Custom resource builder" />
      <ClubLibraryNav />
      {sportsQ.isPending ? (
        <Loader2 className="size-5 animate-spin text-text-tertiary" />
      ) : !sports.length ? (
        <NoSportsCard />
      ) : (
        <>
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap gap-2">
                <SportFilter sports={sports} value={sport} onChange={setSport} />
                <MultiFilterPill
                  aria-label="Audience"
                  className="w-auto min-w-40 max-w-72"
                  placeholder="Who is it for?"
                  value={audience}
                  onValueChange={(v) => setAudience(v as Audience[])}
                  options={[
                    { value: "parents", label: "Parents" },
                    { value: "athletes", label: "Athletes" },
                    { value: "coaches", label: "Coaches" },
                  ]}
                />
                <div className="ml-auto">{orgId && <PdfBrandingSheet orgId={orgId} />}</div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rb-title">Working title</Label>
                <Input
                  id="rb-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="Rink etiquette for new families"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rb-brief">What should it cover?</Label>
                <Textarea
                  id="rb-brief"
                  rows={5}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  maxLength={3000}
                  placeholder="Arrival times, what to bring, where parents can watch, who to ask for help…"
                />
              </div>
              <Button
                className="press"
                disabled={!title.trim() || brief.trim().length < 10 || write.isPending}
                onClick={() => write.mutate()}
              >
                {write.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {draft ? "Write a new draft" : "Write draft"}
              </Button>
            </CardContent>
          </Card>

          {draft && (
            <Card>
              <CardContent className="space-y-4 p-4">
                <p className="text-meta text-text-tertiary">
                  Check every fact before adding it. Fill in anything marked [placeholder].
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="rb-dtitle">Title</Label>
                  <Input
                    id="rb-dtitle"
                    value={draft.title}
                    onChange={(e) => edit((d) => ({ ...d, title: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rb-summary">Summary</Label>
                  <Textarea
                    id="rb-summary"
                    rows={2}
                    value={draft.summary}
                    onChange={(e) => edit((d) => ({ ...d, summary: e.target.value }))}
                  />
                </div>
                {draft.sections.map((s, i) => (
                  <Card key={i} className="bg-elevated">
                    <CardContent className="space-y-2 p-3">
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label={`Section ${i + 1} heading`}
                          value={s.heading}
                          onChange={(e) => setSection(i, { heading: e.target.value })}
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
                          disabled={i === draft.sections.length - 1}
                          onClick={() => swap(i, i + 1)}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="press"
                          aria-label="Remove section"
                          disabled={draft.sections.length === 1}
                          onClick={() =>
                            edit((d) => ({ ...d, sections: d.sections.filter((_, j) => j !== i) }))
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <Textarea
                        aria-label={`Section ${i + 1} text`}
                        rows={6}
                        value={s.body}
                        onChange={(e) => setSection(i, { body: e.target.value })}
                      />
                    </CardContent>
                  </Card>
                ))}
                <Button
                  variant="outline"
                  className="press"
                  disabled={draft.sections.length >= 12}
                  onClick={() =>
                    edit((d) => ({ ...d, sections: [...d.sections, { heading: "", body: "" }] }))
                  }
                >
                  <Plus className="size-4" /> Add section
                </Button>
                <div className="flex flex-wrap gap-2 border-t border-divider pt-4">
                  <Button
                    variant="outline"
                    className="press"
                    disabled={!draft.title.trim() || build.isPending}
                    onClick={() => build.mutate()}
                  >
                    {build.isPending && <Loader2 className="size-4 animate-spin" />} Make PDF
                  </Button>
                  {built?.previewUrl && (
                    <Button asChild variant="ghost" className="press">
                      <a href={built.previewUrl} target="_blank" rel="noreferrer">
                        Open preview
                      </a>
                    </Button>
                  )}
                  {built && !savedId && (
                    <Button
                      className="press"
                      disabled={save.isPending}
                      onClick={() => save.mutate()}
                    >
                      {save.isPending && <Loader2 className="size-4 animate-spin" />} Add to
                      resource library
                    </Button>
                  )}
                  {savedId && (
                    <Button asChild variant="ghost" className="press">
                      <Link to="/org-admin/resources">View in library</Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
