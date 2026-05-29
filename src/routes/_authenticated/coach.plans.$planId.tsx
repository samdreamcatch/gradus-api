import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Search,
  Loader2,
  Send,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { cn } from "@/lib/utils";
import {
  getPlan,
  updatePlan,
  updatePlanMove,
  removePlanMove,
  reorderPlanMoves,
  addLibraryMovesToPlan,
  setPlanStatus,
  deletePlan,
  listCoachAthletes,
  type TargetKind,
} from "@/lib/plans.functions";
import { listMoves, upsertMove, type MoveDTO } from "@/lib/moves.functions";
import { MoveField } from "@/components/coach/move-field";

export const Route = createFileRoute("/_authenticated/coach/plans/$planId")({
  component: PlanEditorSheet,
});

function PlanEditorSheet() {
  const { planId } = Route.useParams();
  const navigate = useNavigate();
  const close = () => navigate({ to: "/coach/plans" });

  // Defensive: if someone hits /coach/plans/new directly, bounce back.
  if (planId === "new") {
    close();
    return null;
  }

  return (
    <Sheet open onOpenChange={(v) => { if (!v) close(); }}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] overflow-y-auto border-t border-divider shadow-page"
        style={{
          backgroundColor: "var(--background)",
          backgroundImage:
            "repeating-linear-gradient(to bottom, transparent 0px, transparent 31px, color-mix(in oklab, var(--foreground) 7%, transparent) 31px, color-mix(in oklab, var(--foreground) 7%, transparent) 32px)",
        }}

      >
        <PlanEditorBody planId={planId} onClose={close} />
      </SheetContent>
    </Sheet>
  );
}

function PlanEditorBody({ planId, onClose }: { planId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const fetchPlan = useServerFn(getPlan);
  const fetchAthletes = useServerFn(listCoachAthletes);
  const updatePlanFn = useServerFn(updatePlan);
  const updateMoveFn = useServerFn(updatePlanMove);
  const removeMoveFn = useServerFn(removePlanMove);
  const reorderFn = useServerFn(reorderPlanMoves);
  const addMovesFn = useServerFn(addLibraryMovesToPlan);
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

  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [expandedMoves, setExpandedMoves] = useState<Record<string, boolean>>({});
  const [didInitExpansion, setDidInitExpansion] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["plan", planId] });
    qc.invalidateQueries({ queryKey: ["plans"] });
  };

  const planUpdate = useMutation({
    mutationFn: updatePlanFn,
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setSavingField(null),
  });
  const moveUpdate = useMutation({
    mutationFn: updateMoveFn,
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setSavingField(null),
  });
  const moveRemove = useMutation({
    mutationFn: removeMoveFn,
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const moveReorder = useMutation({
    mutationFn: reorderFn,
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const moveAdd = useMutation({
    mutationFn: addMovesFn,
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const statusMutation = useMutation({
    mutationFn: statusFn,
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const plan = data?.plan;
  const isTemplate = plan?.kind === "template";
  const isNewFlow = plan?.status === "draft";
  const totalMinutes = (plan?.moves ?? [])
    .filter((m) => m.targetKind === "mins")
    .reduce((s, m) => s + m.targetValue, 0);

  // On first load, expand all when authoring a new draft; collapse all otherwise.
  useEffect(() => {
    if (didInitExpansion || !plan) return;
    const init: Record<string, boolean> = {};
    for (const m of plan.moves) init[m.id] = isNewFlow;
    setExpandedMoves(init);
    setDidInitExpansion(true);
  }, [didInitExpansion, isNewFlow, plan]);

  if (isLoading || !plan) {
    return (
      <div className="py-12 text-center text-sm text-text-secondary">Loading…</div>
    );
  }


  const toggleMove = (id: string) =>
    setExpandedMoves((prev) => ({ ...prev, [id]: !prev[id] }));

  const commit = async <K extends string>(field: K, fn: () => Promise<unknown>) => {
    setSavingField(field);
    await fn().catch(() => {});
  };

  const activate = () => {
    if (!plan.athleteId) {
      toast.error("Assign an athlete first.");
      return;
    }
    if (!plan.title.trim()) {
      toast.error("Give the plan a title.");
      return;
    }
    statusMutation.mutate(
      { data: { id: plan.id, status: "active" } },
      {
        onSuccess: () => {
          toast.success("Plan activated");
          onClose();
        },
      },
    );
  };

  const saveTemplate = () => {
    if (!plan.title.trim()) {
      toast.error("Give the template a title.");
      return;
    }
    statusMutation.mutate(
      { data: { id: plan.id, status: "benched" } },
      {
        onSuccess: () => {
          toast.success("Template saved");
          onClose();
        },
      },
    );
  };

  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= plan.moves.length || from === to) return;
    const ids = plan.moves.map((m) => m.id);
    const [picked] = ids.splice(from, 1);
    ids.splice(to, 0, picked);
    moveReorder.mutate({ data: { planId: plan.id, orderedIds: ids } });
  };

  return (
    <>
      <SheetHeader className="-mx-6 -mt-6 border-b border-divider px-6 pt-5 pb-3">
        <SheetTitle asChild>
          <div>
            <MoveField
              kind="text"
              label="Plan title"
              hideLabel
              value={plan.title}
              placeholder={isNewFlow ? "Name this plan" : "Untitled plan"}
              required
              autoEdit={isNewFlow && !plan.title}
              saving={savingField === "title"}
              onCommit={(v) =>
                commit("title", () => planUpdate.mutateAsync({ data: { id: plan.id, title: v } }))
              }
              displayClassName="font-display text-2xl font-black leading-tight tracking-tight"
              inputClassName="font-display text-2xl font-black leading-tight tracking-tight"
            />
          </div>
        </SheetTitle>
      </SheetHeader>


      <div className="mt-5 space-y-5">


        {/* Assignment */}
        <div className="rounded-lg border border-divider bg-card p-3">


          <div className="flex items-center justify-between gap-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
              Save as template
            </label>
            <Switch
              checked={isTemplate}
              onCheckedChange={(v) =>
                commit("kind", () =>
                  planUpdate.mutateAsync({
                    data: { id: plan.id, kind: v ? "template" : "plan" },
                  }),
                )
              }
            />
          </div>
          {!isTemplate ? (
            <div className="mt-3">
              <MoveField
                kind="select"
                label="Athlete"
                value={
                  plan.athleteId
                    ? athletes.find((a) => a.id === plan.athleteId)?.name ?? ""
                    : ""
                }
                options={athletes.map((a) => a.name)}
                allowFreeText={false}
                placeholder="Choose an athlete"
                saving={savingField === "athleteId"}
                onCommit={(v) => {
                  const match = athletes.find((a) => a.name === v);
                  return commit("athleteId", () =>
                    planUpdate.mutateAsync({
                      data: { id: plan.id, athleteId: match?.id ?? null },
                    }),
                  );
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-divider border-l-[3px] border-l-accent bg-card p-4">
          <MoveField
            kind="textarea"
            label="Notes for the athlete"
            value={plan.notes}
            placeholder="Overall context, focus areas, encouragement…"
            rows={3}
            saving={savingField === "notes"}
            onCommit={(v) =>
              commit("notes", () => planUpdate.mutateAsync({ data: { id: plan.id, notes: v } }))
            }
          />
        </div>

        {/* Moves */}
        <div className="mb-3 mt-2 flex items-end justify-between">
          <h2 className="font-display text-xl font-bold text-text-primary">
            <span className="pen-highlight">Moves</span>
          </h2>
          <span className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
            {plan.moves.length} {plan.moves.length === 1 ? "move" : "moves"}
          </span>

        </div>

        <ul className="space-y-4">
          {plan.moves.map((m, idx) => {
            const expanded = expandedMoves[m.id] ?? isNewFlow;
            return (
              <li
                key={m.id}
                className="relative rounded-lg border border-divider border-l-[3px] border-l-accent bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="select-none pt-1 font-hand text-3xl leading-none text-text-secondary">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      {expanded ? (
                        <div className="divide-y divide-divider/60">
                          <div className="flex items-start justify-between gap-2 pb-3">
                            <div className="min-w-0 flex-1">
                              <MoveField
                                kind="text"
                                label={`Move ${idx + 1}`}
                                hideLabel
                                value={m.name}
                                required
                                saving={savingField === `m-name-${m.id}`}
                                onCommit={(v) =>
                                  commit(`m-name-${m.id}`, () =>
                                    moveUpdate.mutateAsync({ data: { id: m.id, patch: { name: v } } }),
                                  )
                                }
                                displayClassName="font-display text-xl font-black leading-tight tracking-tight"
                                inputClassName="font-display text-xl font-black leading-tight tracking-tight"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleMove(m.id)}
                              aria-label="Collapse move"
                              className="mt-1 shrink-0 text-text-tertiary hover:text-text-primary"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="py-3">
                            <PlanMoveTarget
                              kind={m.targetKind}
                              value={m.targetValue}
                              saving={savingField === `m-target-${m.id}`}
                              onCommit={(k, v) =>
                                commit(`m-target-${m.id}`, () =>
                                  moveUpdate.mutateAsync({
                                    data: { id: m.id, patch: { targetKind: k, targetValue: v } },
                                  }),
                                )
                              }
                            />
                          </div>
                          <div className="py-3">
                            <MoveField
                              kind="textarea"
                              label="Description"
                              value={m.description}
                              placeholder="How to perform the move"
                              rows={3}
                              saving={savingField === `m-desc-${m.id}`}
                              onCommit={(v) =>
                                commit(`m-desc-${m.id}`, () =>
                                  moveUpdate.mutateAsync({
                                    data: { id: m.id, patch: { description: v } },
                                  }),
                                )
                              }
                            />
                          </div>
                          <div className="py-3">
                            <MoveField
                              kind="textarea"
                              label="Cue"
                              value={m.cue}
                              placeholder="One line the athlete can repeat"
                              rows={2}
                              saving={savingField === `m-cue-${m.id}`}
                              onCommit={(v) =>
                                commit(`m-cue-${m.id}`, () =>
                                  moveUpdate.mutateAsync({ data: { id: m.id, patch: { cue: v } } }),
                                )
                              }
                            />
                          </div>
                          <div className="pt-3">
                            <MoveField
                              kind="textarea"
                              label="Why this matters for this athlete"
                              value={m.why}
                              placeholder="Tailor it to this plan"
                              rows={2}
                              saving={savingField === `m-why-${m.id}`}
                              onCommit={(v) =>
                                commit(`m-why-${m.id}`, () =>
                                  moveUpdate.mutateAsync({ data: { id: m.id, patch: { why: v } } }),
                                )
                              }
                            />
                          </div>
                          <div className="flex justify-end pt-3">
                            <button
                              type="button"
                              onClick={() => moveRemove.mutate({ data: { id: m.id } })}
                              className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-tertiary hover:text-destructive"
                              aria-label="Delete move"
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete move
                            </button>
                          </div>
                        </div>

                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleMove(m.id)}
                          aria-expanded={false}
                          className="flex w-full items-center justify-between gap-3 text-left font-display text-xl font-black leading-tight tracking-tight text-text-primary"
                        >
                          <span>
                            {m.name || (
                              <span className="italic text-text-tertiary">Untitled move</span>
                            )}
                          </span>
                          <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary" />
                        </button>
                      )}

                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={() => reorder(idx, idx - 1)}
                      disabled={idx === 0}
                      className="text-text-tertiary disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => reorder(idx, idx + 1)}
                      disabled={idx === plan.moves.length - 1}
                      className="text-text-tertiary disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>



        <Button
          type="button"
          variant="outline"
          onClick={() => setPickerOpen(true)}
          className="w-full gap-2"
        >
          <Plus className="h-4 w-4" />
          Add moves from move library
        </Button>

        <div className="flex items-center justify-between gap-3 border-t border-divider pt-4">
          {plan.status === "active" ? (
            <button
              type="button"
              onClick={() =>
                statusMutation.mutate(
                  { data: { id: plan.id, status: "benched" } },
                  {
                    onSuccess: () => {
                      toast.success("Plan benched");
                      onClose();
                    },
                  },
                )
              }
              disabled={statusMutation.isPending}
              className="text-xs font-bold uppercase tracking-widest text-text-tertiary hover:text-text-primary disabled:opacity-50"
            >
              Bench
            </button>
          ) : plan.status === "benched" ? (
            <span />
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              className="text-xs font-bold uppercase tracking-widest text-text-tertiary hover:text-destructive"
            >
              Delete
            </button>
          )}

          {isTemplate ? (
            <Button
              type="button"
              onClick={saveTemplate}
              disabled={statusMutation.isPending}
              className="gap-2"
            >
              {statusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save template
            </Button>
          ) : (
            <Button
              type="button"
              onClick={activate}
              disabled={statusMutation.isPending || !plan.athleteId}
              className="gap-2"
            >
              {statusMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {plan.status === "active" ? "Update & share" : "Activate & share"}
            </Button>
          )}
        </div>
      </div>

      <MovePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onAdd={(picked) => {
          if (!picked.length) {
            setPickerOpen(false);
            return;
          }
          moveAdd.mutate(
            { data: { planId: plan.id, moveIds: picked.map((m) => m.id) } },
            { onSuccess: () => setPickerOpen(false) },
          );
        }}
      />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{plan.title || "this plan"}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDeleteOpen(false);
                deleteMutation.mutate({ data: { id: plan.id } });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PlanMoveTarget({
  kind,
  value,
  saving,
  onCommit,
}: {
  kind: TargetKind;
  value: number;
  saving?: boolean;
  onCommit: (kind: TargetKind, value: number) => void | Promise<void>;
}) {
  const [localValue, setLocalValue] = useState(String(value));
  // Sync if external value changes
  useEffect(() => setLocalValue(String(value)), [value]);

  const commit = (nextKind: TargetKind, nextValRaw: string) => {
    const n = Math.max(0, Math.min(10000, Number(nextValRaw) || 0));
    setLocalValue(String(n));
    if (n !== value || nextKind !== kind) onCommit(nextKind, n);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
          Target
        </span>
        {saving ? (
          <span className="text-[10px] font-medium text-text-tertiary">Saving…</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-divider">
          {(["reps", "mins"] as TargetKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => commit(k, localValue)}
              className={cn(
                "px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition",
                kind === k
                  ? "bg-accent text-accent-foreground"
                  : "bg-card text-text-secondary hover:text-text-primary",
              )}
            >
              {k}
            </button>
          ))}
        </div>
        <input
          type="number"
          min={0}
          max={10000}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={() => commit(kind, localValue)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-9 w-20 rounded-md border border-divider bg-card px-2 text-sm font-bold text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <span className="text-xs font-medium text-text-tertiary">{kind}</span>
      </div>
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
  const qc = useQueryClient();
  const fetchMoves = useServerFn(listMoves);
  const upsertFn = useServerFn(upsertMove);

  const { data } = useQuery({
    queryKey: ["moves"],
    queryFn: () => fetchMoves(),
    enabled: open,
  });
  const moves = data?.moves ?? [];
  const [mode, setMode] = useState<"pick" | "create">("pick");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, MoveDTO>>({});

  useEffect(() => {
    if (open) {
      setSelected({});
      setMode("pick");
      setQuery("");
    }
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

  const upsertMutation = useMutation({
    mutationFn: upsertFn,
    onSuccess: ({ move }) => {
      qc.invalidateQueries({ queryKey: ["moves"] });
      onAdd([move]);
      toast.success("Saved to library");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">
            {mode === "pick" ? "Add moves" : "New move"}
          </SheetTitle>
        </SheetHeader>

        {mode === "pick" ? (
          <>
            <div className="mt-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search moves"
                  className="h-9 pl-9"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMode("create")}
                className="h-9 gap-1"
              >
                <Plus className="h-4 w-4" /> New
              </Button>
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
                          {m.defaultTargetKind === "mins"
                            ? `${m.defaultTargetValue} mins`
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
          </>
        ) : (
          <NewMoveForm
            existingMoves={moves}
            saving={upsertMutation.isPending}
            onCancel={() => setMode("pick")}
            onUseExisting={(m) => onAdd([m])}
            onCreate={(input) => upsertMutation.mutate({ data: input })}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function similarityScore(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const aw = new Set(na.split(/\s+/).filter((w) => w.length > 2));
  const bw = new Set(nb.split(/\s+/).filter((w) => w.length > 2));
  if (!aw.size || !bw.size) return 0;
  let shared = 0;
  for (const w of aw) if (bw.has(w)) shared++;
  return shared / Math.max(aw.size, bw.size);
}

function NewMoveForm({
  existingMoves,
  saving,
  onCancel,
  onUseExisting,
  onCreate,
}: {
  existingMoves: MoveDTO[];
  saving: boolean;
  onCancel: () => void;
  onUseExisting: (m: MoveDTO) => void;
  onCreate: (input: {
    sport: string;
    category: string;
    name: string;
    description: string;
    cue: string;
    why: string;
    defaultTargetKind: "reps" | "mins";
    defaultTargetValue: number;
  }) => void;
}) {
  const sportOptions = useMemo(
    () => Array.from(new Set(existingMoves.map((m) => m.sport).filter(Boolean))).sort(),
    [existingMoves],
  );

  const [name, setName] = useState("");
  const [sport, setSport] = useState(sportOptions[0] ?? "general");
  const [category, setCategory] = useState("Uncategorized");
  const [cue, setCue] = useState("");
  const [targetKind, setTargetKind] = useState<"reps" | "mins">("reps");
  const [targetValue, setTargetValue] = useState<number>(10);
  const [ignoreDupes, setIgnoreDupes] = useState(false);

  const dupes = useMemo(() => {
    if (!name.trim()) return [];
    return existingMoves
      .map((m) => ({ move: m, score: similarityScore(m.name, name) }))
      .filter((x) => x.score >= 0.6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.move);
  }, [existingMoves, name]);

  const canCreate = name.trim().length > 0 && (dupes.length === 0 || ignoreDupes);

  return (
    <div className="mt-3 flex flex-1 flex-col overflow-y-auto">
      <div className="space-y-3 pb-4">
        <div>
          <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-text-tertiary">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setIgnoreDupes(false);
            }}
            placeholder="Name the move"
            autoFocus
          />
        </div>

        {dupes.length > 0 ? (
          <div className="rounded-md border border-accent/50 bg-accent/10 p-3">
            <p className="text-xs font-bold text-text-primary">
              Already in your library?
            </p>
            <ul className="mt-2 divide-y divide-divider">
              {dupes.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-text-primary">{m.name}</p>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                      {m.category}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onUseExisting(m)}
                    className="gap-1 text-xs"
                  >
                    Use <ArrowRight className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setIgnoreDupes((v) => !v)}
              className="mt-2 text-[11px] font-bold uppercase tracking-widest text-text-secondary hover:text-text-primary"
            >
              {ignoreDupes ? "✓ Creating anyway" : "Ignore — create new anyway"}
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-text-tertiary">
              Sport
            </label>
            <Input
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              list="np-sports"
            />
            <datalist id="np-sports">
              {sportOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-text-tertiary">
              Category
            </label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-text-tertiary">
            Default target
          </label>
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border border-divider">
              {(["reps", "mins"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTargetKind(k)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-bold uppercase tracking-wide",
                    targetKind === k
                      ? "bg-accent text-accent-foreground"
                      : "bg-card text-text-secondary",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
            <Input
              type="number"
              min={0}
              value={targetValue}
              onChange={(e) => setTargetValue(Number(e.target.value) || 0)}
              className="h-9 w-20"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-text-tertiary">
            Cue (optional)
          </label>
          <Input
            value={cue}
            onChange={(e) => setCue(e.target.value)}
            placeholder="One line the athlete can repeat"
          />
        </div>
      </div>

      <div className="sticky bottom-0 mt-auto flex items-center justify-between gap-3 border-t border-divider bg-popover pt-3">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Back
        </Button>
        <Button
          type="button"
          disabled={!canCreate || saving}
          onClick={() =>
            onCreate({
              sport: sport.trim() || "general",
              category: category.trim() || "Uncategorized",
              name: name.trim(),
              description: "",
              cue,
              why: "",
              defaultTargetKind: targetKind,
              defaultTargetValue: targetValue,
            })
          }
          className="gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Save to library &amp; add
        </Button>
      </div>
    </div>
  );
}
