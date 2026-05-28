import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Search,
  Save,
  Power,
  Pause,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  getPlan,
  savePlan,
  setPlanStatus,
  deletePlan,
  listCoachAthletes,
  type PlanMoveDTO,
  type TargetKind,
} from "@/lib/plans.functions";
import { listMoves, type MoveDTO } from "@/lib/moves.functions";

export const Route = createFileRoute("/_authenticated/coach/plans/$planId")({
  component: PlanEditorPage,
});

type DraftMove = Omit<PlanMoveDTO, "id" | "position"> & { key: string };

function PlanEditorPage() {
  const { planId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const fetchPlan = useServerFn(getPlan);
  const fetchAthletes = useServerFn(listCoachAthletes);
  const saveFn = useServerFn(savePlan);
  const statusFn = useServerFn(setPlanStatus);
  const deleteFn = useServerFn(deletePlan);

  const { data, isLoading } = useQuery({
    queryKey: ["plan", planId],
    queryFn: () => fetchPlan({ data: { id: planId } }),
  });
  const { data: athletesData } = useQuery({
    queryKey: ["coach-athletes"],
    queryFn: () => fetchAthletes(),
  });
  const athletes = athletesData?.athletes ?? [];

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [moves, setMoves] = useState<DraftMove[]>([]);
  const [athleteId, setAthleteId] = useState<string>("");
  const [isTemplate, setIsTemplate] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!data?.plan) return;
    setTitle(data.plan.title);
    setNotes(data.plan.notes);
    setAthleteId(data.plan.athleteId ?? "");
    setIsTemplate(data.plan.kind === "template");
    setMoves(
      data.plan.moves.map((m, i) => ({
        key: `${m.id}-${i}`,
        moveId: m.moveId,
        name: m.name,
        description: m.description,
        cue: m.cue,
        why: m.why,
        targetKind: m.targetKind,
        targetValue: m.targetValue,
      })),
    );
  }, [data?.plan]);

  const totalMinutes = useMemo(
    () => moves.filter((m) => m.targetKind === "minutes").reduce((s, m) => s + (m.targetValue || 0), 0),
    [moves],
  );
  const isActive = data?.plan?.status === "active";

  const saveMutation = useMutation({
    mutationFn: saveFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      qc.invalidateQueries({ queryKey: ["plan", planId] });
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: statusFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      qc.invalidateQueries({ queryKey: ["plan", planId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      navigate({ to: "/coach/plans" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMove = (idx: number, patch: Partial<DraftMove>) => {
    setMoves((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  };
  const removeMove = (idx: number) => setMoves((prev) => prev.filter((_, i) => i !== idx));
  const moveUp = (idx: number) => {
    if (idx === 0) return;
    setMoves((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };
  const moveDown = (idx: number) => {
    setMoves((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const addLibraryMoves = (picked: MoveDTO[]) => {
    setMoves((prev) => [
      ...prev,
      ...picked.map((m, i) => ({
        key: `new-${Date.now()}-${i}`,
        moveId: m.id,
        name: m.name,
        description: m.description,
        cue: m.cue,
        why: m.why,
        targetKind: m.defaultTargetKind,
        targetValue: m.defaultTargetValue,
      })),
    ]);
  };

  const handleSave = () => {
    if (!title.trim()) {
      toast.error("Give the plan a title.");
      return;
    }
    if (!isTemplate && !athleteId) {
      toast.error("Assign an athlete or save as template.");
      return;
    }
    saveMutation.mutate({
      data: {
        id: planId,
        title: title.trim(),
        notes,
        kind: isTemplate ? "template" : "plan",
        athleteId: isTemplate ? null : athleteId,
        moves: moves.map((m) => ({
          moveId: m.moveId,
          name: m.name,
          description: m.description,
          cue: m.cue,
          why: m.why,
          targetKind: m.targetKind,
          targetValue: m.targetValue,
        })),
      },
    });
  };

  if (isLoading || !data) {
    return (
      <div className="mx-auto min-h-dvh max-w-3xl px-4 pt-6">
        <p className="text-sm text-text-secondary">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 pt-4 pb-40">
      <div className="mb-4 flex items-center justify-between">
        <Link
          to="/coach/plans"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Plans
        </Link>
        <button
          type="button"
          onClick={() => {
            if (confirm("Delete this plan?")) deleteMutation.mutate({ data: { id: planId } });
          }}
          className="text-xs font-bold uppercase tracking-widest text-text-tertiary hover:text-destructive"
        >
          Delete
        </button>
      </div>

      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Plan title"
        className="!h-auto border-none bg-transparent px-0 font-display !text-3xl font-black tracking-tight text-text-primary shadow-none focus-visible:ring-0"
      />

      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes for this plan…"
        className="mt-2 min-h-[60px] border-none bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
      />

      {/* Assignment row */}
      <div className="mt-4 rounded-lg border border-divider bg-card p-3">
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">
            Template
          </label>
          <Switch checked={isTemplate} onCheckedChange={setIsTemplate} />
        </div>
        {!isTemplate ? (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-text-secondary">
              Athlete
            </label>
            <Select value={athleteId} onValueChange={setAthleteId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an athlete" />
              </SelectTrigger>
              <SelectContent>
                {athletes.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {data.plan.kind === "plan" ? (
              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  variant={isActive ? "secondary" : "default"}
                  size="sm"
                  disabled={!athleteId || statusMutation.isPending}
                  onClick={() =>
                    statusMutation.mutate({
                      data: { id: planId, status: isActive ? "benched" : "active" },
                    })
                  }
                  className="gap-1"
                >
                  {isActive ? <Pause className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                  {isActive ? "Bench" : "Mark active"}
                </Button>
                <span className="text-xs text-text-tertiary">
                  {isActive
                    ? "This is the active plan for this athlete."
                    : "Activating benches their current active plan."}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Moves */}
      <div className="mt-6 mb-2 flex items-end justify-between">
        <h2 className="font-display text-xl font-bold text-text-primary">Moves</h2>
        <span className="text-xs font-bold text-text-tertiary">
          {moves.length} · {totalMinutes} min
        </span>
      </div>

      <ul className="divide-y divide-divider border-y border-divider">
        {moves.map((m, idx) => (
          <li key={m.key} className="py-3">
            <div className="flex items-start gap-2">
              <div className="flex flex-col gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => moveUp(idx)}
                  disabled={idx === 0}
                  className="text-text-tertiary disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveDown(idx)}
                  disabled={idx === moves.length - 1}
                  className="text-text-tertiary disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  value={m.name}
                  onChange={(e) => updateMove(idx, { name: e.target.value })}
                  className="!h-8 border-none bg-transparent px-0 text-sm font-bold shadow-none focus-visible:ring-0"
                />
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={m.targetValue}
                    onChange={(e) =>
                      updateMove(idx, { targetValue: Number(e.target.value) || 0 })
                    }
                    className="h-7 w-16"
                  />
                  <div className="flex rounded-md bg-elevated p-0.5 text-[11px] font-bold">
                    {(["reps", "minutes"] as TargetKind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => updateMove(idx, { targetKind: k })}
                        className={cn(
                          "rounded px-2 py-0.5 uppercase tracking-tight",
                          m.targetKind === k
                            ? "bg-card text-text-primary shadow-sm"
                            : "text-text-secondary",
                        )}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
                {m.cue ? (
                  <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{m.cue}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => removeMove(idx)}
                className="pt-1 text-text-tertiary hover:text-destructive"
                aria-label="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        onClick={() => setPickerOpen(true)}
        className="mt-3 w-full gap-2"
      >
        <Plus className="h-4 w-4" />
        Add moves from library
      </Button>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-divider bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="text-xs text-text-secondary">
            <span className="font-bold text-text-primary">{moves.length}</span> moves ·{" "}
            <span className="font-bold text-text-primary">{totalMinutes}</span> min
          </div>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            Save
          </Button>
        </div>
      </div>

      <MovePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onAdd={(picked) => {
          addLibraryMoves(picked);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function MovePicker({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (moves: MoveDTO[]) => void;
}) {
  const fetchMoves = useServerFn(listMoves);
  const { data } = useQuery({
    queryKey: ["moves"],
    queryFn: () => fetchMoves(),
    enabled: open,
  });
  const moves = data?.moves ?? [];
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, MoveDTO>>({});

  useEffect(() => {
    if (open) setSelected({});
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return moves;
    return moves.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.cue.toLowerCase().includes(q),
    );
  }, [moves, query]);

  const count = Object.keys(selected).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">Add moves</SheetTitle>
        </SheetHeader>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search moves"
            className="h-9 pl-9"
          />
        </div>
        <ul className="mt-3 flex-1 divide-y divide-divider overflow-y-auto">
          {filtered.map((m) => {
            const isSel = !!selected[m.id];
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() =>
                    setSelected((prev) => {
                      const next = { ...prev };
                      if (next[m.id]) delete next[m.id];
                      else next[m.id] = m;
                      return next;
                    })
                  }
                  className={cn(
                    "flex w-full items-start gap-3 py-2.5 text-left transition",
                    isSel && "bg-accent/10",
                  )}
                >
                  <div
                    className={cn(
                      "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      isSel ? "border-accent bg-accent" : "border-divider",
                    )}
                  >
                    {isSel ? <span className="text-[10px] font-black text-accent-foreground">✓</span> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-text-primary">
                      {m.name}
                    </p>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                      {m.category} ·{" "}
                      {m.defaultTargetKind === "minutes"
                        ? `${m.defaultTargetValue} min`
                        : `${m.defaultTargetValue} reps`}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-divider pt-3">
          <span className="text-xs font-bold text-text-secondary">
            {count} selected
          </span>
          <Button
            onClick={() => onAdd(Object.values(selected))}
            disabled={count === 0}
          >
            Add {count > 0 ? count : ""}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
