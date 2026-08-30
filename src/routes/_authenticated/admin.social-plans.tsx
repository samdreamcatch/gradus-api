import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Sparkles } from "lucide-react";
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
  adminCreateSocialPlan,
  adminListSocialPlans,
  adminDeleteSocialPlan,
  type SocialPlanMoveInput,
} from "@/lib/social-plans.functions";

export const Route = createFileRoute("/_authenticated/admin/social-plans")({
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
  const [moves, setMoves] = useState<SocialPlanMoveInput[]>([emptyMove()]);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);

  const sportObj = SPORTS.find((s) => s.key === sport);
  const sportLabel = sportObj?.label ?? sport;
  const levels = sportObj?.levels ?? [];

  const patchMove = (i: number, patch: Partial<SocialPlanMoveInput>) =>
    setMoves((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied", { description: url });
    } catch {
      toast.success("Share link", { description: url });
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

  const handleCreate = async () => {
    const clean = moves.filter((m) => m.name.trim());
    if (!title.trim() || clean.length === 0) {
      toast.error("Add a title and at least one move");
      return;
    }
    setSaving(true);
    try {
      const res = await createFn({ data: { title: title.trim(), notes, moves: clean } });
      await copy(`${SITE_ORIGIN}/p/${res.token}`);
      setTitle("");
      setNotes("");
      setMoves([emptyMove()]);
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
            <Button type="button" onClick={handleDraft} disabled={drafting} className="w-full">
              <Sparkles className="size-4" />
              {drafting ? "Drafting…" : "Draft with AI"}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-divider bg-card p-5 space-y-4">
        <h2 className="font-display text-h3 text-text-primary">2. Edit the plan</h2>
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
            {saving ? "Publishing…" : "Publish & copy share link"}
          </Button>
        </div>
      </section>

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
                    onClick={() => copy(`${SITE_ORIGIN}/p/${p.shareToken}`)}
                  >
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
