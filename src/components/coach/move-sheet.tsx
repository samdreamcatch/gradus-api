import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listMoves,
  upsertMove,
  archiveMove,
  type MoveDTO,
  type TargetKind,
} from "@/lib/moves.functions";
import { listPlans, addMoveToPlan } from "@/lib/plans.functions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { MoveField } from "./move-field";
import { NameConflictDialog } from "./name-conflict-dialog";

type Mode = "new" | string; // moveId or "new"

export function MoveSheet({
  selection,
  onOpenChange,
}: {
  selection: Mode | null;
  onOpenChange: (next: Mode | null) => void;
}) {
  const open = selection !== null;
  const vv = useVisualViewport();
  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onOpenChange(null);
      }}
    >
      <SheetContent
        side="bottom"
        className="overflow-y-auto border-t border-divider shadow-page"
        style={{
          backgroundColor: "var(--popover)",
          backgroundImage: "none",
          bottom: vv.keyboardInset,
          maxHeight: Math.round(vv.height * 0.9),
        }}
      >

        {open ? (
          <MoveSheetBody
            selection={selection!}
            onSelect={onOpenChange}
            onClose={() => onOpenChange(null)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function MoveSheetBody({
  selection,
  onSelect,
  onClose,
}: {
  selection: Mode;
  onSelect: (next: Mode | null) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fetchMoves = useServerFn(listMoves);
  const upsertFn = useServerFn(upsertMove);
  const archiveFn = useServerFn(archiveMove);
  // Capture whether this sheet session was started as a new move,
  // so we keep showing "Save" (instead of "Duplicate") even after
  // the row is auto-created on first field commit.
  const [openedAsNew] = useState(selection === "new");

  const { data } = useQuery({
    queryKey: ["moves"],
    queryFn: () => fetchMoves(),
  });
  const moves = data?.moves ?? [];
  const seedCategories = data?.seedCategories ?? [];
  const existing = selection !== "new" ? moves.find((m) => m.id === selection) : undefined;

  const sportOptions = useMemo(
    () => Array.from(new Set(moves.map((m) => m.sport).filter(Boolean))).sort(),
    [moves],
  );
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_");
  const currentSport = (existing?.sport ?? (selection === "new" ? undefined : "")) ?? "";
  const categoryOptions = useMemo(() => {
    const fromMoves = moves
      .filter((m) => (currentSport ? normalize(m.sport) === normalize(currentSport) : true))
      .map((m) => m.category);
    const fromSeed = seedCategories
      .filter((s) => (currentSport ? normalize(s.sport) === normalize(currentSport) : true))
      .map((s) => s.category);
    return Array.from(new Set([...fromMoves, ...fromSeed].filter(Boolean))).sort();
  }, [moves, seedCategories, currentSport]);


  // Local draft for "new" mode (before first save)
  const [draft, setDraft] = useState<Partial<MoveDTO>>({
    sport: sportOptions[0] ?? "",
    category: "",
    name: "",
    description: "",
    cue: "",
    why: "",
    defaultTargetKind: "reps",
    defaultTargetValue: 10,
  });
  const [savingField, setSavingField] = useState<string | null>(null);

  type UpsertPayload = Parameters<typeof upsertFn>[0]["data"];
  const [conflict, setConflict] = useState<{
    existingMoveId: string;
    existingName: string;
    attemptedName: string;
    payload: UpsertPayload;
    /** Whether this attempt was creating a brand-new library move. */
    wasNew: boolean;
  } | null>(null);

  const isNew = selection === "new" && !existing;
  const move: Partial<MoveDTO> = existing ?? draft;

  const upsertMutation = useMutation({
    mutationFn: upsertFn,
    onSuccess: (res, variables) => {
      if (!res.ok) {
        setConflict({
          existingMoveId: res.conflict.existingMoveId,
          existingName: res.conflict.name,
          attemptedName: variables.data.name,
          payload: variables.data,
          wasNew: !variables.data.id && !variables.data.overwriteMoveId,
        });
        return;
      }
      qc.invalidateQueries({ queryKey: ["moves"] });
      if (isNew) onSelect(res.move.id);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setSavingField(null),
  });

  const archiveMutation = useMutation({
    mutationFn: archiveFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moves"] });
      toast.success("Move archived");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function commitField<K extends keyof MoveDTO>(field: K, next: MoveDTO[K]) {
    setSavingField(field as string);
    if (isNew) {
      const merged = { ...draft, [field]: next };
      setDraft(merged);
      // Only create the row once we have a non-empty name
      if (field === "name" && typeof next === "string" && next.trim()) {
        await upsertMutation.mutateAsync({
          data: {
            sport: merged.sport || "general",
            category: merged.category || "Uncategorized",
            name: (merged.name as string).trim(),
            description: merged.description ?? "",
            cue: merged.cue ?? "",
            why: merged.why ?? "",
            defaultTargetKind: (merged.defaultTargetKind as TargetKind) ?? "reps",
            defaultTargetValue: Number(merged.defaultTargetValue ?? 10),
          },
        });
      } else {
        setSavingField(null);
      }
      return;
    }
    if (!existing) {
      setSavingField(null);
      return;
    }
    const base = {
      id: existing.id,
      sport: existing.sport,
      category: existing.category,
      name: existing.name,
      description: existing.description,
      cue: existing.cue,
      why: existing.why,
      defaultTargetKind: existing.defaultTargetKind,
      defaultTargetValue: existing.defaultTargetValue,
    };
    await upsertMutation.mutateAsync({
      data: { ...base, [field]: next },
    });
  }


  const duplicate = async () => {
    if (!existing) return;
    setSavingField("__dup");
    try {
      const res = await upsertMutation.mutateAsync({
        data: {
          sport: existing.sport,
          category: existing.category,
          name: `${existing.name} (copy)`,
          description: existing.description,
          cue: existing.cue,
          why: existing.why,
          defaultTargetKind: existing.defaultTargetKind,
          defaultTargetValue: existing.defaultTargetValue,
        },
      });
      if (res.ok) {
        onSelect(res.move.id);
        toast.success("Duplicated");
      }
    } finally {
      setSavingField(null);
    }
  };

  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);

  const archive = () => {
    if (!existing) return;
    setConfirmArchiveOpen(true);
  };

  const confirmArchive = () => {
    if (!existing) return;
    setConfirmArchiveOpen(false);
    archiveMutation.mutate({ data: { id: existing.id } });
  };


  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-display text-2xl">
          {isNew ? "New move" : "Move"}
        </SheetTitle>
      </SheetHeader>

      <div className="mt-5 space-y-5">
        {/* Title */}
        <div>
          <MoveField
            kind="text"
            label="Name"
            value={move.name ?? ""}
            placeholder={isNew ? "Name this move" : "Add a name"}
            required
            autoEdit={isNew}
            saving={savingField === "name"}
            onCommit={(v) => commitField("name", v)}
            displayClassName="font-display text-h3 font-black leading-tight tracking-tight"
            inputClassName="font-display text-h3 font-black leading-tight tracking-tight"
          />
          {move.name ? (
            <div className="-mt-1 ml-2">
              <span className="pen-highlight inline-block h-1 w-12" aria-hidden />
            </div>
          ) : null}
        </div>

        {/* Sport / Category */}
        <div className="grid grid-cols-2 gap-3">
          <MoveField
            kind="select"
            label="Sport"
            value={move.sport ?? ""}
            options={sportOptions}
            placeholder="Sport"
            saving={savingField === "sport"}
            onCommit={(v) => commitField("sport", v)}
          />
          <MoveField
            kind="select"
            label="Category"
            value={move.category ?? ""}
            options={categoryOptions}
            placeholder="Category"
            saving={savingField === "category"}
            onCommit={(v) => commitField("category", v)}
          />
        </div>

        {/* Target */}
        <TargetEditor
          kind={(move.defaultTargetKind as TargetKind) ?? "reps"}
          value={Number(move.defaultTargetValue ?? 0)}
          saving={savingField === "defaultTargetKind" || savingField === "defaultTargetValue"}
          onCommit={async (k, v) => {
            if (k !== move.defaultTargetKind) await commitField("defaultTargetKind", k);
            if (v !== move.defaultTargetValue) await commitField("defaultTargetValue", v);
          }}
        />

        <MoveField
          kind="textarea"
          label="Cue"
          value={move.cue ?? ""}
          placeholder="One line the athlete can repeat to themselves"
          rows={2}
          saving={savingField === "cue"}
          onCommit={(v) => commitField("cue", v)}
        />


        {/* Why */}
        <MoveField
          kind="textarea"
          label="Why this matters"
          value={move.why ?? ""}
          placeholder="What this move develops, in plain language"
          rows={3}
          saving={savingField === "why"}
          onCommit={(v) => commitField("why", v)}
        />

        {/* Description */}
        <MoveField
          kind="textarea"
          label="Description"
          value={move.description ?? ""}
          placeholder="How to perform the move, step by step"
          rows={4}
          saving={savingField === "description"}
          onCommit={(v) => commitField("description", v)}
        />

        {!isNew && existing ? (
          <div className="flex items-center justify-between gap-2 border-t border-divider pt-4">
            <div className="flex items-center gap-1">
              <AddToPlanAction moveId={existing.id} />
              {openedAsNew ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onClose}
                  disabled={upsertMutation.isPending || savingField !== null}
                >
                  {upsertMutation.isPending || savingField !== null ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Save
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={duplicate}
                  disabled={upsertMutation.isPending}
                >
                  {savingField === "__dup" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  Duplicate
                </Button>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={archive}
              disabled={archiveMutation.isPending}
              aria-label="Archive"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </div>

      <AlertDialog open={confirmArchiveOpen} onOpenChange={setConfirmArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive "{existing?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              You can recreate it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmArchive}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TargetEditor({
  kind,
  value,
  onCommit,
  saving,
  disabled,
}: {
  kind: TargetKind;
  value: number;
  onCommit: (kind: TargetKind, value: number) => void | Promise<void>;
  saving?: boolean;
  disabled?: boolean;
}) {
  const [localKind, setLocalKind] = useState<TargetKind>(kind);
  const [localValue, setLocalValue] = useState<string>(String(value));

  // Sync external updates
  useEffect(() => {
    setLocalKind(kind);
    setLocalValue(String(value));
  }, [kind, value]);


  const commit = () => {
    const n = Math.max(0, Math.min(10000, Number(localValue) || 0));
    setLocalValue(String(n));
    if (n !== value || localKind !== kind) onCommit(localKind, n);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
          Default target
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
              disabled={disabled}
              onClick={() => {
                setLocalKind(k);
                if (k !== kind) onCommit(k, Number(localValue) || 0);
              }}
              className={cn(
                "px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition",
                localKind === k
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
          disabled={disabled}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-9 w-20 rounded-md border border-divider bg-card px-2 text-sm font-bold text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <span className="text-xs font-medium text-text-tertiary">{localKind}</span>
      </div>
    </div>
  );
}

function AddToPlanAction({ moveId }: { moveId: string }) {
  const qc = useQueryClient();
  const fetchPlans = useServerFn(listPlans);
  const addFn = useServerFn(addMoveToPlan);
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["plans", { kind: "plan", status: "active" }],
    queryFn: () => fetchPlans({ data: { kind: "plan", status: "active" } }),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: addFn,
    onSuccess: ({ planId, planTitle }) => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      qc.invalidateQueries({ queryKey: ["plan", planId] });
      toast.success(`Added to ${planTitle}`);
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const plans = data?.plans ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Add to plan
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-divider px-3 py-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
            Add to a plan
          </span>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-4 text-text-tertiary">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : plans.length === 0 ? (
            <p className="px-3 py-4 text-sm text-text-tertiary">No active plans yet.</p>
          ) : (
            <ul className="divide-y divide-divider">
              {plans.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() =>
                      mutation.mutate({ data: { planId: p.id, moveId } })
                    }
                    disabled={mutation.isPending}
                    className="block w-full px-3 py-2.5 text-left transition hover:bg-elevated disabled:opacity-50"
                  >
                    <p className="truncate text-sm font-bold text-text-primary">
                      {p.title || "Untitled plan"}
                    </p>
                    {p.athleteName ? (
                      <p className="mt-0.5 text-xs text-text-tertiary">
                        {p.athleteName}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-text-tertiary">Unassigned</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
