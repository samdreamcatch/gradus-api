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
  BarChart3,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
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
  createPlan,
  listCoachAthletes,
  listCoachSports,
  getAthleteActivePlans,
  MAX_ACTIVE_PLANS_PER_ATHLETE,
  type TargetKind,
  type PlanMoveDTO,
} from "@/lib/plans.functions";
import { ShareToSocialsButton } from "@/components/plans/share-to-socials-button";
import { getOrCreateShareToken } from "@/lib/plan-share.functions";




import {
  listMoves,
  upsertMove,
  addPlanMoveToLibrary,
  updateLibraryMoveFromPlanMove,
  forkPlanMoveToLibrary,
  type MoveDTO,
} from "@/lib/moves.functions";

import { MoveField } from "@/components/coach/move-field";
import { NameConflictDialog } from "@/components/coach/name-conflict-dialog";
import { VoiceFab } from "@/components/coach/voice-fab";
import { consumeVoiceTouched, type VoiceTouchedSnapshot } from "@/lib/voice-touched-store";
import { FlowStateBars } from "@/components/plans/flow-state-bars";
import { getPlanSessions, getPlanSessionsSummary } from "@/lib/plan-sessions.functions";

const PUBLIC_OPTION = "Public / Shareable Link";
const TEMPLATE_OPTION = "Save as Template";
const SITE_ORIGIN = "https://gradus.training";

export const Route = createFileRoute("/_authenticated/coach/plans/$planId")({

  component: PlanEditorSheet,
  validateSearch: (search: Record<string, unknown>) => ({
    from: search.from === "plus" ? ("plus" as const) : undefined,
  }),
  loader: ({ params, context }) => {
    if (params.planId === "new") return;
    return context.queryClient.ensureQueryData({
      queryKey: ["plan", params.planId],
      queryFn: () => getPlan({ data: { id: params.planId } }),
    });
  },
});

function PlanEditorSheet() {
  const { planId } = Route.useParams();
  const { from } = Route.useSearch();
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
            "radial-gradient(1200px 800px at 100% 0%, color-mix(in oklab, var(--pen-pool) 18%, transparent), transparent 60%), radial-gradient(1000px 700px at 0% 100%, color-mix(in oklab, var(--pen-tennis) 16%, transparent), transparent 60%), repeating-linear-gradient(to bottom, transparent 0px, transparent 31px, color-mix(in oklab, var(--foreground) 7%, transparent) 31px, color-mix(in oklab, var(--foreground) 7%, transparent) 32px)",
        }}

      >
        <PlanEditorBody planId={planId} onClose={close} from={from} />
      </SheetContent>
    </Sheet>
  );
}
function PlanEditorBody({ planId, onClose, from }: { planId: string; onClose: () => void; from?: "plus" }) {

  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchPlan = useServerFn(getPlan);
  const fetchAthletes = useServerFn(listCoachAthletes);
  const updatePlanFn = useServerFn(updatePlan);
  const updateMoveFn = useServerFn(updatePlanMove);
  const removeMoveFn = useServerFn(removePlanMove);
  const reorderFn = useServerFn(reorderPlanMoves);
  const addMovesFn = useServerFn(addLibraryMovesToPlan);
  const statusFn = useServerFn(setPlanStatus);
  const deleteFn = useServerFn(deletePlan);
  const createPlanFn = useServerFn(createPlan);
  const getActivesFn = useServerFn(getAthleteActivePlans);
  const shareTokenFn = useServerFn(getOrCreateShareToken);



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
  const [useTemplateOpen, setUseTemplateOpen] = useState(false);
  const [pendingAssignment, setPendingAssignment] = useState<null | "public" | "template" | "athlete">(null);
  const [activeConflicts, setActiveConflicts] = useState<{ id: string; title: string }[] | null>(null);
  const [chosenReplaceId, setChosenReplaceId] = useState<string | null>(null);

  const [touched, setTouched] = useState<VoiceTouchedSnapshot>(
    () => consumeVoiceTouched(planId) ?? { plan: {}, moves: {}, newMoveIds: [] },
  );
  const clearPlanTouch = (key: "title" | "athleteId" | "notes") =>
    setTouched((t) => {
      if (!t.plan[key]) return t;
      const next = { ...t, plan: { ...t.plan } };
      delete next.plan[key];
      return next;
    });
  const clearMoveTouch = (moveId: string, field?: string) =>
    setTouched((t) => {
      const existing = t.moves[moveId];
      if (!existing) return t;
      const nextMoves = { ...t.moves };
      if (!field) {
        delete nextMoves[moveId];
      } else {
        const remaining = existing.filter((f) => f !== field);
        if (remaining.length === 0) delete nextMoves[moveId];
        else nextMoves[moveId] = remaining;
      }
      return { ...t, moves: nextMoves, newMoveIds: t.newMoveIds.filter((id) => id !== moveId) };
    });
  const isMoveFieldTouched = (moveId: string, field: string) => {
    if (touched.newMoveIds.includes(moveId)) return true;
    return touched.moves[moveId]?.includes(field) ?? false;
  };
  const planSource = (key: "title" | "athleteId" | "notes") =>
    touched.sources?.plan?.[key]?.quote;
  const moveSource = (
    moveId: string,
    field: "name" | "description" | "cue" | "why" | "target",
  ) => touched.sources?.moves?.[moveId]?.[field]?.quote;


  const clearAllTouched = () =>
    setTouched({ plan: {}, moves: {}, newMoveIds: [] });
  const touchedCount =
    Object.keys(touched.plan).length +
    Object.keys(touched.moves).length +
    touched.newMoveIds.length;



  const useTemplate = useMutation({
    mutationFn: createPlanFn,
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast.success("Copy created");
      navigate({ to: "/coach/plans/$planId", params: { planId: id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });


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

  const fetchPlanSessions = useServerFn(getPlanSessions);
  const sessionsQuery = useQuery({
    queryKey: ["plan-sessions", plan?.id],
    queryFn: () => fetchPlanSessions({ data: { planId: plan!.id } }),
    enabled: !!plan?.id,
  });
  const loggedSessions =
    sessionsQuery.data?.sessionsByState ?? {
      frustrated: 0,
      pushing: 0,
      steady: 0,
      lockedIn: 0,
      flowing: 0,
    };
  const loggedSessionsTotal = sessionsQuery.data?.sessionsTotal ?? 0;

  const fetchPlanSessionsSummary = useServerFn(getPlanSessionsSummary);
  const summaryQuery = useQuery({
    queryKey: ["plan-sessions-summary", plan?.id, loggedSessionsTotal],
    queryFn: () => fetchPlanSessionsSummary({ data: { planId: plan!.id } }),
    enabled: !!plan?.id && plan?.status === "active" && loggedSessionsTotal > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Derive assignment mode for the merged "Assign to" dropdown.
  // Pending selection wins over the saved value so the UI stays consistent
  // during the save round-trip after picking a new option in the dropdown.
  const assignmentMode: "athlete" | "public" | "template" | null = isTemplate
    ? "template"
    : pendingAssignment === "athlete"
    ? "athlete"
    : pendingAssignment === "public"
    ? "public"
    : pendingAssignment === "template"
    ? "template"
    : plan?.athleteId
    ? "athlete"
    : null;

  // Prefetch share token so "Publish & Share" can invoke navigator.share
  // synchronously in the click handler (needed for iOS Safari user activation).
  const { data: prefetchedShare } = useQuery({
    queryKey: ["plan-share-token", plan?.id],
    queryFn: () => shareTokenFn({ data: { planId: plan!.id } }),
    enabled: !!plan?.id && assignmentMode === "public",
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  if (isLoading || !plan) {
    return (
      <div className="py-8 text-center text-sm text-text-secondary">Loading…</div>
    );
  }




  const toggleMove = (id: string) =>
    setExpandedMoves((prev) => ({ ...prev, [id]: !prev[id] }));

  const commit = async <K extends string>(field: K, fn: () => Promise<unknown>) => {
    setSavingField(field);
    await fn().catch(() => {});
  };

  const performActivate = (replaceId?: string) => {
    statusMutation.mutate(
      { data: { id: plan.id, status: "active", ...(replaceId ? { replaceId } : {}) } },
      {
        onSuccess: () => {
          toast.success(replaceId ? "Plan activated · previous plan benched" : "Plan activated");
          setActiveConflicts(null);
          setChosenReplaceId(null);
          onClose();
        },
        onError: (e: Error) => {
          if (e.message === "BENCH_CHOICE_REQUIRED") {
            // Refetch and surface the choice dialog.
            void openConflictDialog();
          } else {
            toast.error(e.message);
          }
        },
      },
    );
  };

  const openConflictDialog = async () => {
    if (!plan.athleteId) return;
    try {
      const { plans } = await getActivesFn({
        data: { athleteId: plan.athleteId, excludePlanId: plan.id },
      });
      if (plans.length === 0) {
        performActivate();
        return;
      }
      setActiveConflicts(plans);
      setChosenReplaceId(plans.length === 1 ? plans[0].id : null);
    } catch (e) {
      toast.error((e as Error).message);
    }
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
    void openConflictDialog();
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

  const publishAndShare = () => {
    if (!plan.title.trim()) {
      toast.error("Give the plan a title.");
      return;
    }
    // Fire native share sheet SYNCHRONOUSLY (user activation is preserved
    // only in the same tick as the click). Kick off the activation mutation
    // in parallel — order matters, share must not be awaited.
    const caption = `${plan.title || "Untitled plan"} — My workout on Gradus`;
    const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
    if (prefetchedShare?.token && canShare) {
      const url = `${SITE_ORIGIN}/p/${prefetchedShare.token}`;
      navigator.share({ title: plan.title || "Untitled plan", text: caption, url }).catch(() => {});
    } else if (prefetchedShare?.token) {
      const url = `${SITE_ORIGIN}/p/${prefetchedShare.token}`;
      navigator.clipboard?.writeText(url).catch(() => {});
      toast.success("Link copied", { description: url });
    }
    statusMutation.mutate(
      { data: { id: plan.id, status: "active" } },
      {
        onSuccess: () => {
          toast.success(plan.status === "active" ? "Plan updated" : "Plan published");
          onClose();
        },
      },
    );
  };

  const saveToLibrary = () => {
    if (!plan.title.trim()) {
      toast.error("Give the plan a title.");
      return;
    }
    void useTemplate.mutateAsync({
      data: { kind: "template", fromPlanId: plan.id },
    });
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
      <SheetHeader className="-mx-6 -mt-6 border-b border-divider px-6 pt-5 pb-3 pr-14">
        <SheetTitle asChild>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <MoveField
                kind="text"
                label="Plan title"
                hideLabel
                value={plan.title}
                placeholder={isNewFlow ? "Name this plan" : "Untitled plan"}
                required
                autoEdit={isNewFlow && !plan.title}
                saving={savingField === "title"}
                highlighted={!!touched.plan.title}
                sourceQuote={planSource("title")}

                onCommit={(v) => {
                  clearPlanTouch("title");
                  return commit("title", () =>
                    planUpdate.mutateAsync({ data: { id: plan.id, title: v } }),
                  );
                }}
                displayClassName="font-display text-2xl font-black leading-tight tracking-tight"
                inputClassName="font-display text-2xl font-black leading-tight tracking-tight"
              />
            </div>
            {from === "plus" ? null : (
              <VoiceFab
                mode="edit"
                planId={plan.id}
                variant="inline"
                className="mt-1 shrink-0"
                onVoiceApplied={(r) =>
                  setTouched((prev) => ({
                    plan: { ...prev.plan, ...r.touched.plan },
                    moves: { ...prev.moves, ...r.touched.moves },
                    newMoveIds: [...prev.newMoveIds, ...r.touched.newMoveIds],
                    transcript: r.touched.transcript ?? prev.transcript,
                    sources: {
                      plan: { ...(prev.sources?.plan ?? {}), ...(r.touched.sources?.plan ?? {}) },
                      moves: { ...(prev.sources?.moves ?? {}), ...(r.touched.sources?.moves ?? {}) },
                    },
                  }))
                }
              />
            )}

          </div>
        </SheetTitle>
      </SheetHeader>

      {touchedCount > 0 ? (
        <div className="-mx-6 mt-3 flex items-center justify-between gap-3 border-b border-divider bg-elevated px-6 py-2">
          <span className="font-hand text-base text-text-primary">
            From your voice — tweak anything, then approve.
          </span>
          <button
            type="button"
            onClick={clearAllTouched}
            className="rounded-full bg-accent px-3 py-1 text-[11px] font-black uppercase tracking-widest text-accent-foreground"
          >
            Looks good
          </button>
        </div>
      ) : null}


      <div className="mt-5 space-y-5 pb-2">

        {/* Assignment — compact */}
        <div className="rounded-lg border border-divider bg-card px-3 py-2">
          {isTemplate ? (
            <div className="flex items-center justify-between gap-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
                Use this template
              </label>
              <Switch
                checked={useTemplateOpen}
                disabled={useTemplate.isPending}
                onCheckedChange={setUseTemplateOpen}
              />
            </div>
          ) : (
            <MoveField
              kind="select"
              label="Assign to"
              value={
                assignmentMode === "public"
                  ? PUBLIC_OPTION
                  : assignmentMode === "template"
                  ? TEMPLATE_OPTION
                  : plan.athleteId
                  ? athletes.find((a) => a.id === plan.athleteId)?.name ?? ""
                  : ""
              }
              options={[
                PUBLIC_OPTION,
                TEMPLATE_OPTION,
                ...athletes.map((a) => a.name),
              ]}
              dividerAfter={[TEMPLATE_OPTION]}
              allowFreeText={false}
              placeholder="Public, template, or athlete"
              saving={savingField === "assignment" || useTemplate.isPending}
              highlighted={!!touched.plan.athleteId}
              sourceQuote={planSource("athleteId")}
              onCommit={(v) => {
                clearPlanTouch("athleteId");
                if (v === PUBLIC_OPTION) {
                  setPendingAssignment("public");
                  if (plan.athleteId) {
                    return commit("assignment", () =>
                      planUpdate.mutateAsync({
                        data: { id: plan.id, athleteId: null },
                      }),
                    );
                  }
                  return;
                }
                if (v === TEMPLATE_OPTION) {
                  setPendingAssignment("template");
                  return;
                }
                const match = athletes.find((a) => a.name === v);
                setPendingAssignment(null);
                return commit("assignment", () =>
                  planUpdate.mutateAsync({
                    data: { id: plan.id, athleteId: match?.id ?? null },
                  }),
                );
              }}
            />
          )}
          {isTemplate && useTemplateOpen ? (
            <div className="mt-2 border-t border-divider pt-2">
              <MoveField
                kind="select"
                label="Assign to athlete"
                value=""
                options={athletes.map((a) => a.name)}
                allowFreeText={false}
                placeholder="Choose an athlete"
                saving={useTemplate.isPending}
                onCommit={async (v) => {
                  const match = athletes.find((a) => a.name === v);
                  if (!match) return;
                  await useTemplate.mutateAsync({
                    data: {
                      kind: "plan",
                      athleteId: match.id,
                      fromTemplateId: plan.id,
                    },
                  });
                }}
              />
              <p className="mt-1 text-[11px] text-text-tertiary">
                Creates a new draft from this template.
              </p>
            </div>
          ) : null}
        </div>





        {plan.status === "active" ? (
          <div className="space-y-3">
            {/* Logged instances bar chart */}
            <div className="rounded-lg border border-divider bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-text-tertiary" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
                    Logged instances
                  </span>
                </div>
                <span className="text-xs text-text-tertiary tabular-nums">
                  {loggedSessionsTotal === 0
                    ? "0 sessions"
                    : `${loggedSessionsTotal} session${loggedSessionsTotal === 1 ? "" : "s"}`}
                </span>
              </div>
              <FlowStateBars counts={loggedSessions} />

              {/* AI summary of logged sessions */}
              <div className="mt-4 border-t border-dashed border-divider pt-3">
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-text-tertiary" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
                    Summary
                  </span>
                </div>
                {loggedSessionsTotal === 0 ? (
                  <p className="text-xs text-text-tertiary">
                    No sessions logged yet. A summary will appear once {plan.athleteName?.split(" ")[0] ?? "your athlete"} starts logging practice.
                  </p>
                ) : summaryQuery.isLoading ? (
                  <div className="space-y-1.5" aria-hidden>
                    <div className="h-2 w-full animate-pulse rounded bg-elevated" />
                    <div className="h-2 w-11/12 animate-pulse rounded bg-elevated" />
                    <div className="h-2 w-4/5 animate-pulse rounded bg-elevated" />
                  </div>
                ) : summaryQuery.isError ? (
                  <p className="text-xs text-text-tertiary">
                    Couldn't generate a summary right now.
                  </p>
                ) : (
                  <p className="text-xs leading-relaxed text-text-secondary">
                    {summaryQuery.data?.summary}
                  </p>
                )}
              </div>

            </div>



          </div>
        ) : null}





        {/* Moves */}
        <div className="mb-3 mt-2 flex items-end justify-between">
          <p className="text-[11px] font-black uppercase tracking-widest text-text-secondary">
            What does {plan.athleteName?.split(" ")[0] ?? "your athlete"} need to work on?
          </p>
        </div>

        <ul className="space-y-1.5">
          {plan.moves.map((m, idx) => {
            const expanded = expandedMoves[m.id] ?? isNewFlow;
            const isNewMove = touched.newMoveIds.includes(m.id);
            const unit = m.targetKind === "mins" ? "min" : "reps";
            return (
              <li
                key={m.id}
                className={cn(
                  "rounded-2xl border bg-card shadow-card transition-colors",
                  expanded ? "border-accent" : "border-divider",
                  isNewMove && "ring-2 ring-accent/40 ring-offset-2 ring-offset-background",
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleMove(m.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 px-3.5 py-2 text-left"
                >
                  <span className="flex shrink-0 items-baseline gap-1 tabular-nums">
                    <span className="font-display text-[18px] font-black text-text-primary">
                      {m.targetValue}
                    </span>
                    <span className="text-[11px] text-text-tertiary">{unit}</span>
                  </span>
                  <span className="flex-1 truncate font-display text-[15px] text-text-primary">
                    {m.name ? (
                      <span
                        className={cn(
                          !expanded &&
                            (isNewMove || touched.moves[m.id]?.length) &&
                            "pen-highlight",
                        )}
                      >
                        {m.name}
                      </span>
                    ) : (
                      <span className="italic text-text-tertiary">Untitled move</span>
                    )}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-text-tertiary transition-transform",
                      expanded && "rotate-180",
                    )}
                  />
                </button>

                {expanded ? (
                  <div className="space-y-3 px-3.5 pb-3">
                    <div className="border-t border-divider/60 pt-3">
                      <MoveField
                        kind="text"
                        label={`Move ${idx + 1}`}
                        hideLabel
                        value={m.name}
                        required
                        saving={savingField === `m-name-${m.id}`}
                        highlighted={isMoveFieldTouched(m.id, "name")}
                        sourceQuote={moveSource(m.id, "name")}
                        onCommit={(v) => {
                          clearMoveTouch(m.id, "name");
                          return commit(`m-name-${m.id}`, () =>
                            moveUpdate.mutateAsync({ data: { id: m.id, patch: { name: v } } }),
                          );
                        }}
                        displayClassName="font-display text-base font-bold leading-tight tracking-tight"
                        inputClassName="font-display text-base font-bold leading-tight tracking-tight"
                      />
                    </div>

                    <div
                      className={cn(
                        (isMoveFieldTouched(m.id, "targetKind") ||
                          isMoveFieldTouched(m.id, "targetValue")) &&
                          "rounded-md bg-accent/10 px-2 py-1 ring-1 ring-accent/40",
                      )}
                    >
                      <PlanMoveTarget
                        kind={m.targetKind}
                        value={m.targetValue}
                        saving={savingField === `m-target-${m.id}`}
                        onCommit={(k, v) => {
                          clearMoveTouch(m.id, "targetKind");
                          clearMoveTouch(m.id, "targetValue");
                          return commit(`m-target-${m.id}`, () =>
                            moveUpdate.mutateAsync({
                              data: { id: m.id, patch: { targetKind: k, targetValue: v } },
                            }),
                          );
                        }}
                      />
                    </div>

                    <MoveField
                      kind="textarea"
                      label="Description"
                      value={m.description}
                      placeholder="How to perform the move"
                      rows={3}
                      saving={savingField === `m-desc-${m.id}`}
                      highlighted={isMoveFieldTouched(m.id, "description")}
                      sourceQuote={moveSource(m.id, "description")}
                      onCommit={(v) => {
                        clearMoveTouch(m.id, "description");
                        return commit(`m-desc-${m.id}`, () =>
                          moveUpdate.mutateAsync({
                            data: { id: m.id, patch: { description: v } },
                          }),
                        );
                      }}
                    />

                    <MoveField
                      kind="textarea"
                      label="Cue"
                      value={m.cue}
                      placeholder="One line to help the athlete in the moment"
                      rows={2}
                      saving={savingField === `m-cue-${m.id}`}
                      highlighted={isMoveFieldTouched(m.id, "cue")}
                      sourceQuote={moveSource(m.id, "cue")}
                      onCommit={(v) => {
                        clearMoveTouch(m.id, "cue");
                        return commit(`m-cue-${m.id}`, () =>
                          moveUpdate.mutateAsync({ data: { id: m.id, patch: { cue: v } } }),
                        );
                      }}
                    />

                    <MoveField
                      kind="textarea"
                      label="Why this matters for this athlete"
                      value={m.why}
                      placeholder="Tailor it to this plan"
                      rows={2}
                      saving={savingField === `m-why-${m.id}`}
                      highlighted={isMoveFieldTouched(m.id, "why")}
                      sourceQuote={moveSource(m.id, "why")}
                      onCommit={(v) => {
                        clearMoveTouch(m.id, "why");
                        return commit(`m-why-${m.id}`, () =>
                          moveUpdate.mutateAsync({ data: { id: m.id, patch: { why: v } } }),
                        );
                      }}
                    />

                    {m.moveId === null ? (
                      <AddToLibrarySection planMove={m} onAdded={invalidate} />
                    ) : (
                      <LibrarySyncStrip planMove={m} onSynced={invalidate} />
                    )}


                    <div className="flex items-center justify-between border-t border-divider/60 pt-3">

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => reorder(idx, idx - 1)}
                          disabled={idx === 0}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-elevated hover:text-text-primary disabled:opacity-30"
                          aria-label="Move up"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => reorder(idx, idx + 1)}
                          disabled={idx === plan.moves.length - 1}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-elevated hover:text-text-primary disabled:opacity-30"
                          aria-label="Move down"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                      </div>
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
                ) : null}
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

        <div className="rounded-lg border border-divider bg-card p-4">
          <MoveField
            kind="textarea"
            label="Other notes on this plan"
            value={plan.notes}
            placeholder="Overall context, focus areas, encouragement…"
            rows={3}
            saving={savingField === "notes"}
            highlighted={!!touched.plan.notes}
            sourceQuote={planSource("notes")}

            onCommit={(v) => {
              clearPlanTouch("notes");
              return commit("notes", () =>
                planUpdate.mutateAsync({ data: { id: plan.id, notes: v } }),
              );
            }}
          />
        </div>

        {plan.voiceTranscript ? (
          <details className="rounded-lg border border-divider bg-card p-4 text-sm">
            <summary className="cursor-pointer select-none text-muted-foreground">
              What you dictated
            </summary>
            <p className="mt-3 whitespace-pre-wrap text-foreground">
              {plan.voiceTranscript}
            </p>
          </details>
        ) : null}




        <div className="sticky bottom-0 -mx-6 mt-4 flex items-center justify-between gap-3 border-t border-divider bg-popover px-6 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
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
          ) : assignmentMode === "template" ? (
            <Button
              type="button"
              onClick={saveToLibrary}
              disabled={useTemplate.isPending}
              className="gap-2"
            >
              {useTemplate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save to Library
            </Button>
          ) : assignmentMode === "public" ? (
            <ShareToSocialsButton
              planId={plan.id}
              planTitle={plan.title || "Untitled plan"}
              variant="primary"
              label={plan.status === "active" ? "Update & Share" : "Publish & Share"}
              disabled={statusMutation.isPending || !plan.title.trim()}
              onShareInvoked={() => {
                statusMutation.mutate(
                  { data: { id: plan.id, status: "active" } },
                  {
                    onSuccess: () => {
                      toast.success(plan.status === "active" ? "Plan updated" : "Plan published");
                      onClose();
                    },
                  },
                );
              }}
            />

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
              {plan.status === "active" ? "Update & Share" : "Activate & Share"}
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

      <AlertDialog
        open={!!activeConflicts}
        onOpenChange={(v) => { if (!v) { setActiveConflicts(null); setChosenReplaceId(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            {activeConflicts && activeConflicts.length >= MAX_ACTIVE_PLANS_PER_ATHLETE ? (
              <>
                <AlertDialogTitle>Athlete already has two active plans</AlertDialogTitle>
                <AlertDialogDescription>
                  Athlete already has two active plans to work on before they next see you. Choose a plan to bench.
                </AlertDialogDescription>
              </>
            ) : (
              <>
                <AlertDialogTitle>Replace existing active plan?</AlertDialogTitle>
                <AlertDialogDescription>
                  Athlete already has an active plan from you. Do you want to replace it with this one?
                </AlertDialogDescription>
              </>
            )}
          </AlertDialogHeader>
          {activeConflicts && activeConflicts.length >= MAX_ACTIVE_PLANS_PER_ATHLETE ? (
            <div className="space-y-2 py-1">
              {activeConflicts.map((p) => (
                <label
                  key={p.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border border-divider px-3 py-2 text-sm",
                    chosenReplaceId === p.id && "border-accent bg-accent/10",
                  )}
                >
                  <input
                    type="radio"
                    name="bench-choice"
                    checked={chosenReplaceId === p.id}
                    onChange={() => setChosenReplaceId(p.id)}
                  />
                  <span className="text-text-primary">{p.title || "Untitled plan"}</span>
                </label>
              ))}
            </div>
          ) : activeConflicts && activeConflicts.length === 1 ? (
            <p className="text-sm text-text-secondary">
              Replacing will bench "{activeConflicts[0].title || "Untitled plan"}". Or keep both active.
            </p>
          ) : null}
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            {activeConflicts && activeConflicts.length >= MAX_ACTIVE_PLANS_PER_ATHLETE ? (
              <>
                <AlertDialogAction
                  disabled={!chosenReplaceId}
                  onClick={() => {
                    if (!chosenReplaceId) return;
                    performActivate(chosenReplaceId);
                  }}
                >
                  Bench & activate
                </AlertDialogAction>
                <AlertDialogAction
                  className="bg-card text-text-primary border border-divider hover:bg-elevated"
                  onClick={() => {
                    statusMutation.mutate(
                      { data: { id: plan.id, status: "draft" } },
                      {
                        onSuccess: () => {
                          toast.success("Saved as draft");
                          setActiveConflicts(null);
                          setChosenReplaceId(null);
                          onClose();
                        },
                        onError: (e: Error) => toast.error(e.message),
                      },
                    );
                  }}
                >
                  Save as draft
                </AlertDialogAction>
              </>
            ) : (
              <>
                <AlertDialogAction
                  onClick={() => {
                    if (activeConflicts && activeConflicts[0]) {
                      performActivate(activeConflicts[0].id);
                    }
                  }}
                >
                  Replace & activate
                </AlertDialogAction>
                <AlertDialogAction
                  className="bg-card text-text-primary border border-divider hover:bg-elevated"
                  onClick={() => performActivate()}
                >
                  Keep both active
                </AlertDialogAction>
              </>
            )}
            
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

  const [nameConflict, setNameConflict] = useState<
    | { existingMoveId: string; existingName: string; attemptedName: string }
    | null
  >(null);
  const [lastCreateInput, setLastCreateInput] = useState<Parameters<
    NonNullable<React.ComponentProps<typeof NewMoveForm>["onCreate"]>
  >[0] | null>(null);

  const upsertMutation = useMutation({
    mutationFn: upsertFn,
    onSuccess: (res) => {
      if (!res.ok) {
        setNameConflict({
          existingMoveId: res.conflict.existingMoveId,
          existingName: res.conflict.name,
          attemptedName: lastCreateInput?.name ?? "",
        });
        return;
      }
      qc.invalidateQueries({ queryKey: ["moves"] });
      onAdd([res.move]);
      toast.success("Saved to library");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const vv = useVisualViewport();

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex flex-col"
        style={{
          bottom: vv.keyboardInset,
          maxHeight: Math.round(vv.height * 0.85),
        }}
      >
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
            onCreate={(input) => {
              setLastCreateInput(input);
              upsertMutation.mutate({ data: input });
            }}
          />
        )}
      </SheetContent>
    </Sheet>
    <NameConflictDialog
      open={!!nameConflict}
      attemptedName={nameConflict?.attemptedName ?? ""}
      existingName={nameConflict?.existingName ?? ""}
      busy={upsertMutation.isPending}
      onOpenChange={(v: boolean) => !v && setNameConflict(null)}
      onOverwrite={() => {
        if (!nameConflict || !lastCreateInput) return;
        upsertMutation.mutate({
          data: { ...lastCreateInput, overwriteMoveId: nameConflict.existingMoveId },
        });
        setNameConflict(null);
      }}
    />
    </>
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

  const canCreate =
    name.trim().length > 0 && cue.trim().length > 0 && (dupes.length === 0 || ignoreDupes);

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
            Cue
          </label>
          <Input
            value={cue}
            onChange={(e) => setCue(e.target.value)}
            placeholder="One line to help the athlete in the moment"
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

function AddToLibrarySection({
  planMove,
  onAdded,
}: {
  planMove: PlanMoveDTO;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sport, setSport] = useState("");
  const [category, setCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const addFn = useServerFn(addPlanMoveToLibrary);
  const fetchSports = useServerFn(listCoachSports);
  const fetchMoves = useServerFn(listMoves);
  const sportsQuery = useQuery({
    queryKey: ["coach-sports"],
    queryFn: () => fetchSports(),
    enabled: open,
  });
  const movesQuery = useQuery({
    queryKey: ["moves"],
    queryFn: () => fetchMoves(),
    enabled: open,
  });
  const sports = sportsQuery.data?.sports ?? [];

  const categoryOptions = useMemo(() => {
    if (!sport) return [] as string[];
    const set = new Set<string>();
    for (const m of movesQuery.data?.moves ?? []) {
      if (m.sport === sport && m.category) set.add(m.category);
    }
    for (const s of movesQuery.data?.seedCategories ?? []) {
      if (s.sport === sport && s.category) set.add(s.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [sport, movesQuery.data]);

  useEffect(() => {
    if (open && sports.length > 0 && !sport) setSport(sports[0]);
  }, [open, sports, sport]);

  useEffect(() => {
    // Reset category when sport changes
    setCategory("");
    setCustomCategory("");
  }, [sport]);

  const [conflict, setConflict] = useState<
    | { existingMoveId: string; existingName: string; payload: { planMoveId: string; sport: string; category: string } }
    | null
  >(null);

  const mutation = useMutation({
    mutationFn: addFn,
    onSuccess: (res, variables) => {
      if (!res.ok) {
        const payload = (variables?.data ?? {}) as { planMoveId: string; sport: string; category: string };
        setConflict({
          existingMoveId: res.conflict.existingMoveId,
          existingName: res.conflict.name,
          payload,
        });
        return;
      }
      toast.success("Saved to your move library");
      setOpen(false);
      setCategory("");
      setCustomCategory("");
      onAdded();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cueOk = planMove.cue.trim().length > 0;
  const whyOk = planMove.why.trim().length > 0;
  const ready = cueOk && whyOk;
  const missing: string[] = [];
  if (!cueOk) missing.push("a cue");
  if (!whyOk) missing.push("a why");

  return (
    <div className="rounded-lg border border-dashed border-accent/50 bg-accent/5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 text-xs">
          <p className="font-bold uppercase tracking-wide text-text-secondary">
            Not in your library
          </p>
          <p className="mt-0.5 text-text-tertiary">
            {ready
              ? "Save this move so you can reuse it in future plans."
              : `Add ${missing.join(" and ")} to save this move to your library.`}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!ready}
          onClick={() => setOpen(true)}
        >
          Add to library
        </Button>
      </div>
      <AlertDialog open={open} onOpenChange={(v) => !mutation.isPending && setOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save "{planMove.name}" to your library</AlertDialogTitle>
            <AlertDialogDescription>
              Pick a sport and category so you can find this move next time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-1">
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
                Sport
              </span>
              <select
                value={sport}
                onChange={(e) => setSport(e.target.value)}
                className="mt-1 block w-full rounded-md border border-divider bg-card px-2 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                {sports.length === 0 ? (
                  <option value="">No sports configured</option>
                ) : null}
                {sports.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
                Category
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 block w-full rounded-md border border-divider bg-card px-2 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                disabled={!sport || movesQuery.isLoading}
              >
                <option value="">
                  {movesQuery.isLoading ? "Loading…" : "Select a category…"}
                </option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__other__">Other…</option>
              </select>
              {category === "__other__" ? (
                <Input
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="e.g. Forehand, Footwork, Strength"
                  className="mt-2"
                  autoFocus
                />
              ) : null}
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !sport.trim() ||
                !category ||
                (category === "__other__" && !customCategory.trim()) ||
                mutation.isPending
              }
              onClick={(e) => {
                e.preventDefault();
                const finalCategory =
                  category === "__other__" ? customCategory.trim() : category;
                mutation.mutate({
                  data: {
                    planMoveId: planMove.id,
                    sport: sport.trim(),
                    category: finalCategory,
                  },
                });
              }}
            >
              {mutation.isPending ? "Saving…" : "Save to library"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NameConflictDialog
        open={!!conflict}
        attemptedName={planMove.name}
        existingName={conflict?.existingName ?? ""}
        busy={mutation.isPending}
        onOpenChange={(v) => !v && setConflict(null)}
        onOverwrite={() => {
          if (!conflict) return;
          mutation.mutate({
            data: { ...conflict.payload, overwriteMoveId: conflict.existingMoveId },
          });
          setConflict(null);
        }}
      />
    </div>
  );
}

function diffLibraryFields(
  planMove: PlanMoveDTO,
): { changed: string[]; libName: string } | null {
  const lib = planMove.libraryMove;
  if (!lib) return null;
  const changed: string[] = [];
  if (planMove.name.trim() !== lib.name.trim()) changed.push("name");
  if ((planMove.description ?? "").trim() !== (lib.description ?? "").trim())
    changed.push("description");
  if (planMove.cue.trim() !== lib.cue.trim()) changed.push("cue");
  if (planMove.why.trim() !== lib.why.trim()) changed.push("why");
  if (planMove.targetKind !== lib.defaultTargetKind) changed.push("target");
  else if (Number(planMove.targetValue) !== Number(lib.defaultTargetValue))
    changed.push("target");
  if (changed.length === 0) return null;
  return { changed, libName: lib.name };
}

function LibrarySyncStrip({
  planMove,
  onSynced,
}: {
  planMove: PlanMoveDTO;
  onSynced: () => void;
}) {
  const diff = diffLibraryFields(planMove);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [sport, setSport] = useState("");
  const [category, setCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [forkName, setForkName] = useState(planMove.name);


  const updateFn = useServerFn(updateLibraryMoveFromPlanMove);
  const forkFn = useServerFn(forkPlanMoveToLibrary);
  const fetchSports = useServerFn(listCoachSports);
  const fetchMoves = useServerFn(listMoves);

  const sportsQuery = useQuery({
    queryKey: ["coach-sports"],
    queryFn: () => fetchSports(),
    enabled: forkOpen,
  });
  const movesQuery = useQuery({
    queryKey: ["moves"],
    queryFn: () => fetchMoves(),
    enabled: forkOpen,
  });

  const updateMutation = useMutation({
    mutationFn: updateFn,
    onSuccess: () => {
      toast.success("Library move updated");
      setConfirmUpdate(false);
      onSynced();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [forkConflict, setForkConflict] = useState<
    | { existingMoveId: string; existingName: string; payload: { planMoveId: string; sport: string; category: string; name: string } }
    | null
  >(null);

  const forkMutation = useMutation({
    mutationFn: forkFn,
    onSuccess: (res, variables) => {
      if (!res.ok) {
        const payload = (variables?.data ?? {}) as { planMoveId: string; sport: string; category: string; name: string };
        setForkConflict({
          existingMoveId: res.conflict.existingMoveId,
          existingName: res.conflict.name,
          payload,
        });
        return;
      }
      toast.success("Saved as new library move");
      setForkOpen(false);
      setCategory("");
      setCustomCategory("");
      onSynced();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sports = sportsQuery.data?.sports ?? [];
  useEffect(() => {
    if (forkOpen && !sport && sports.length) setSport(sports[0]);
  }, [forkOpen, sport, sports]);
  useEffect(() => {
    if (forkOpen) setForkName(planMove.name);
  }, [forkOpen, planMove.name]);

  const categoryOptions = useMemo(() => {
    const all = movesQuery.data?.moves ?? [];
    return Array.from(
      new Set(all.filter((m) => m.sport === sport).map((m) => m.category)),
    ).sort();
  }, [movesQuery.data, sport]);

  if (!diff) return null;

  const changedLabel = diff.changed.join(", ");

  return (
    <div className="rounded-lg border border-dashed border-accent/50 bg-accent/5 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-bold uppercase tracking-wide text-text-secondary">
            Edited from library
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setConfirmUpdate(true)}
          >
            Update library
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setForkOpen(true)}
          >
            Save as new
          </Button>
        </div>
      </div>

      <AlertDialog
        open={confirmUpdate}
        onOpenChange={(v) => !updateMutation.isPending && setConfirmUpdate(v)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update "{diff.libName}" in your library?</AlertDialogTitle>
            <AlertDialogDescription>
              This overwrites {changedLabel} on the library move. Existing plans that
              already use this move keep their current text — only future plans pick up
              the new version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={updateMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                updateMutation.mutate({ data: { planMoveId: planMove.id } });
              }}
            >
              {updateMutation.isPending ? "Updating…" : "Update library"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={forkOpen}
        onOpenChange={(v) => !forkMutation.isPending && setForkOpen(v)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save as a new library move</AlertDialogTitle>
            <AlertDialogDescription>
              Name it, then pick a sport and category so you can find it next time. The
              original library move is left untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-1">
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
                Name
              </span>
              <Input
                value={forkName}
                onChange={(e) => setForkName(e.target.value)}
                placeholder="Move name"
                className="mt-1"
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
                Sport
              </span>
              <select
                value={sport}
                onChange={(e) => setSport(e.target.value)}
                className="mt-1 block w-full rounded-md border border-divider bg-card px-2 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                {sports.length === 0 ? <option value="">No sports configured</option> : null}
                {sports.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
                Category
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 block w-full rounded-md border border-divider bg-card px-2 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                disabled={!sport || movesQuery.isLoading}
              >
                <option value="">
                  {movesQuery.isLoading ? "Loading…" : "Select a category…"}
                </option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__other__">Other…</option>
              </select>
              {category === "__other__" ? (
                <Input
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="e.g. Forehand, Footwork, Strength"
                  className="mt-2"
                  autoFocus
                />
              ) : null}
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={forkMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !sport.trim() ||
                !category ||
                (category === "__other__" && !customCategory.trim()) ||
                !forkName.trim() ||
                forkMutation.isPending
              }
              onClick={(e) => {
                e.preventDefault();
                const finalCategory =
                  category === "__other__" ? customCategory.trim() : category;
                forkMutation.mutate({
                  data: {
                    planMoveId: planMove.id,
                    sport: sport.trim(),
                    category: finalCategory,
                    name: forkName.trim(),
                  },
                });
              }}
            >
              {forkMutation.isPending ? "Saving…" : "Save as new move"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NameConflictDialog
        open={!!forkConflict}
        attemptedName={forkName}

        existingName={forkConflict?.existingName ?? ""}
        busy={forkMutation.isPending}
        onOpenChange={(v) => !v && setForkConflict(null)}
        onOverwrite={() => {
          if (!forkConflict) return;
          forkMutation.mutate({
            data: { ...forkConflict.payload, overwriteMoveId: forkConflict.existingMoveId },
          });
          setForkConflict(null);
        }}
      />
    </div>
  );
}

