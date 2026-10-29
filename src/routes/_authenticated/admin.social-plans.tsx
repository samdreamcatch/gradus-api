import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Sparkles, Pencil, Copy, Save, X } from "lucide-react";
import { copyText } from "@/lib/copy-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SPORTS } from "@/lib/coach-sports";
import {
  adminDraftSocialPlan,
  adminDraftSocialPlanFromResult,
  adminCreateSocialPlan,
  adminListSocialPlans,
  adminDeleteSocialPlan,
  adminGetSocialPlan,
  adminUpdateSocialPlan,
  type SocialPlanMoveInput,
} from "@/lib/social-plans.functions";

export const Route = createFileRoute("/_authenticated/admin/social-plans")({
  head: () => ({
    meta: [
      { title: "Social plans — Gradus Admin" },
      {
        name: "description",
        content: "Create and edit Gradus shared practice plans and coach attribution.",
      },
      { property: "og:title", content: "Social plans — Gradus Admin" },
      { property: "og:description", content: "Manage Gradus shared practice plans." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SocialPlansPage,
});

const SITE_ORIGIN = "https://gradus.training";

const emptyMove = (): SocialPlanMoveInput => ({
  name: "",
  description: "",
  cue: "",
  why: "",
  targetKind: "reps",
  targetValue: 10,
});

function SocialPlansPage() {
  const draftFn = useServerFn(adminDraftSocialPlan);
  const createFn = useServerFn(adminCreateSocialPlan);
  const listFn = useServerFn(adminListSocialPlans);
  const deleteFn = useServerFn(adminDeleteSocialPlan);
  const getFn = useServerFn(adminGetSocialPlan);
  const updateFn = useServerFn(adminUpdateSocialPlan);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-social-plans"],
    queryFn: () => listFn(),
  });

  const [sport, setSport] = useState<string>(SPORTS[0]?.key ?? "tennis");
  const [level, setLevel] = useState("");
  const [focus, setFocus] = useState("");
  const [moveCount, setMoveCount] = useState(4);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [coachName, setCoachName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [moves, setMoves] = useState<SocialPlanMoveInput[]>([emptyMove()]);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resultFile, setResultFile] = useState<File | null>(null);
  const [resultText, setResultText] = useState("");
  const draftFromResultFn = useServerFn(adminDraftSocialPlanFromResult);

  const sportObj = SPORTS.find((s) => s.key === sport);
  const sportLabel = sportObj?.label ?? sport;
  const levels = sportObj?.levels ?? [];

  const patchMove = (i: number, patch: Partial<SocialPlanMoveInput>) =>
    setMoves((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const copy = async (url: string) => {
    setShareUrl(url);
    if (await copyText(url)) {
      toast.success("Share link copied", { description: url });
    } else {
      toast.error("Copy is blocked by your browser. Select the share link to copy it.");
    }
  };

  const resetEditor = () => {
    setEditingId(null);
    setTitle("");
    setNotes("");
    setCoachName("");
    setMoves([emptyMove()]);
  };

  const handleEdit = async (planId: string) => {
    setLoadingId(planId);
    try {
      const plan = await getFn({ data: { planId } });
      setEditingId(planId);
      setTitle(plan.title);
      setNotes(plan.notes);
      setCoachName(plan.coachName);
      setMoves(plan.moves);
      document.getElementById("plan-editor")?.scrollIntoView({ block: "start" });
      document.getElementById("plan-title")?.focus({ preventScroll: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the plan");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDraft = async () => {
    setDrafting(true);
    try {
      const res = await draftFn({
        data: {
          sport: sportLabel,
          level: levels.find((l) => l.key === level)?.label ?? "",
          focus: focus.trim(),
          moveCount,
        },
      });
      setTitle(res.title);
      setNotes(res.notes);
      setMoves(res.moves);
      toast.success("Draft ready — edit anything before you publish");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not draft the plan");
    } finally {
      setDrafting(false);
    }
  };

  const handleDraftFromResult = async () => {
    if (resultFile && resultFile.size > 10 * 1024 * 1024) {
      toast.error("That file is over 10 MB");
      return;
    }
    setDrafting(true);
    try {
      const fileDataUrl = resultFile
        ? await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = () => reject(new Error("Could not read the file"));
            r.readAsDataURL(resultFile);
          })
        : undefined;
      const res = await draftFromResultFn({
        data: { sport: sportLabel, text: resultText.trim(), fileDataUrl, moveCount },
      });
      setTitle(res.title);
      setNotes(res.notes);
      setMoves(res.moves);
      toast.success("Draft ready — edit anything before you publish");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not draft the plan");
    } finally {
      setDrafting(false);
    }
  };

  const handleCreate = async () => {
    const clean = moves.filter((m) => m.name.trim());
    if (!title.trim() || clean.length === 0) {
      toast.error("Add a title and at least one move");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateFn({
          data: { planId: editingId, title: title.trim(), notes, coachName, moves: clean },
        });
        toast.success("Plan updated");
      } else {
        const res = await createFn({
          data: { title: title.trim(), notes, coachName, moves: clean },
        });
        await copy(`${SITE_ORIGIN}/p/${res.token}`);
      }
      resetEditor();
      setFocus("");
      await qc.invalidateQueries({ queryKey: ["admin-social-plans"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the plan");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (planId: string) => {
    try {
      await deleteFn({ data: { planId } });
      if (editingId === planId) resetEditor();
      await qc.invalidateQueries({ queryKey: ["admin-social-plans"] });
      toast.success("Plan deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  };

  const plans = data?.plans ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      <header className="space-y-3">
        <Link
          to="/admin"
          search={{ test: false }}
          className="text-xs font-semibold uppercase tracking-widest text-text-secondary hover:text-text-primary"
        >
          ← Admin
        </Link>
        <h1 className="font-display text-h1 text-text-primary">Social plans</h1>
        <p className="max-w-3xl text-sm text-text-secondary">
          Build a shareable practice plan for any sport — no athlete or coach attached. Publishing
          mints a public link at <span className="font-mono">gradus.training/p/…</span> that anyone
          can open, and coaches can save to their library.
        </p>
      </header>

      <section className="rounded-2xl border border-divider bg-card p-5 space-y-4">
        <h2 className="font-display text-h3 text-text-primary">1. Pick a sport</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Sport</Label>
            <Select
              value={sport}
              onValueChange={(v) => {
                setSport(v);
                setLevel("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPORTS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Level (optional)</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger>
                <SelectValue placeholder="All levels" />
              </SelectTrigger>
              <SelectContent>
                {levels.map((l) => (
                  <SelectItem key={l.key} value={l.key}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="focus">Focus (optional)</Label>
            <Input
              id="focus"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. off-ice jump technique, serve rhythm, hip mobility"
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="move-count">Number of moves</Label>
            <Input
              id="move-count"
              type="number"
              min={2}
              max={8}
              value={moveCount}
              onChange={(e) => setMoveCount(Math.min(8, Math.max(2, Number(e.target.value) || 4)))}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={handleDraft}
              disabled={drafting || saving || Boolean(editingId)}
              className="w-full"
            >
              <Sparkles className="size-4" />
              {drafting ? "Drafting…" : "Draft with AI"}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-divider bg-card p-5 space-y-4">
        <h2 className="font-display text-h3 text-text-primary">
          Or draft from a competition result
        </h2>
        <div className="space-y-1.5">
          <Label htmlFor="result-file">Result image or PDF</Label>
          <Input
            id="result-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setResultFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="result-text">Or paste the result text</Label>
          <Textarea
            id="result-text"
            value={resultText}
            onChange={(e) => setResultText(e.target.value)}
            rows={4}
            maxLength={20000}
            placeholder="Paste a protocol, score sheet, or results summary"
          />
        </div>
        <Button
          type="button"
          onClick={handleDraftFromResult}
          disabled={drafting || saving || Boolean(editingId) || (!resultFile && !resultText.trim())}
        >
          <Sparkles className="size-4" />
          {drafting ? "Reading result…" : `Draft ${sportLabel} plan from result`}
        </Button>
      </section>

      <section id="plan-editor" className="rounded-2xl border border-divider bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-h3 text-text-primary">
            {editingId ? "Edit published plan" : "2. Edit the plan"}
          </h2>
          {editingId ? (
            <Button variant="ghost" size="sm" onClick={resetEditor} disabled={saving}>
              <X className="size-4" />
              Cancel
            </Button>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="coach-name">Coach name</Label>
          <Input
            id="coach-name"
            value={coachName}
            onChange={(e) => setCoachName(e.target.value)}
            maxLength={120}
            placeholder="A Gradus coach"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-title">Title</Label>
          <Input
            id="plan-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`${sportLabel} — 10 minute warm-up`}
            maxLength={140}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-notes">Intro note</Label>
          <Textarea
            id="plan-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={1000}
          />
        </div>

        <div className="space-y-4">
          {moves.map((m, i) => (
            <div key={i} className="rounded-xl border border-divider bg-elevated p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
                  Move {i + 1}
                </Eyebrow>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove move ${i + 1}`}
                  onClick={() => setMoves((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={moves.length === 1}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <Input
                value={m.name}
                onChange={(e) => patchMove(i, { name: e.target.value })}
                placeholder="Move name"
                maxLength={120}
              />
              <Textarea
                value={m.description}
                onChange={(e) => patchMove(i, { description: e.target.value })}
                placeholder="How to do it"
                rows={2}
                maxLength={600}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={m.cue}
                  onChange={(e) => patchMove(i, { cue: e.target.value })}
                  placeholder="Coaching cue"
                  maxLength={300}
                />
                <Input
                  value={m.why}
                  onChange={(e) => patchMove(i, { why: e.target.value })}
                  placeholder="Why it matters"
                  maxLength={300}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  value={m.targetKind}
                  onValueChange={(v) => patchMove(i, { targetKind: v as "reps" | "mins" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reps">Reps</SelectItem>
                    <SelectItem value="mins">Minutes</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  max={600}
                  value={m.targetValue}
                  onChange={(e) =>
                    patchMove(i, {
                      targetValue: Math.min(600, Math.max(1, Number(e.target.value) || 1)),
                    })
                  }
                />
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setMoves((prev) => [...prev, emptyMove()])}
            disabled={moves.length >= 12}
          >
            <Plus className="size-4" />
            Add move
          </Button>
        </div>

        <div className="pt-2">
          <Button type="button" onClick={handleCreate} disabled={saving}>
            <Save className="size-4" />
            {saving ? "Saving…" : editingId ? "Save changes" : "Publish & copy share link"}
          </Button>
        </div>
      </section>

      {shareUrl ? (
        <div className="space-y-2">
          <Label htmlFor="share-url">Share link</Label>
          <div className="flex gap-2">
            <Input id="share-url" value={shareUrl} readOnly onFocus={(e) => e.target.select()} />
            <Button variant="secondary" onClick={() => copy(shareUrl)} aria-label="Copy share link">
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl border border-divider bg-card p-5">
        <h2 className="font-display text-h3 text-text-primary mb-3">
          Published social plans ({plans.length})
        </h2>
        {plans.length === 0 ? (
          <p className="text-sm text-text-secondary">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {plans.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-divider bg-elevated px-3 py-2"
              >
                <span className="text-sm text-text-primary">
                  {p.title}
                  <span className="text-text-secondary">
                    {" "}
                    — {p.moveCount} move{p.moveCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={saving || loadingId !== null}
                    onClick={() => handleEdit(p.id)}
                  >
                    <Pencil className="size-4" />
                    {loadingId === p.id ? "Opening…" : "Edit"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => copy(`${SITE_ORIGIN}/p/${p.shareToken}`)}
                  >
                    <Copy className="size-4" />
                    Copy share link
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(p.id)}
                    aria-label="Delete plan"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
