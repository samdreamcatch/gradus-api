import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listMoves,
  upsertMove,
  archiveMove,
  type MoveDTO,
  type TargetKind,
} from "@/lib/moves.functions";
import { MoveField } from "./move-field";

type Mode = "new" | string; // moveId or "new"

export function MoveSheet({
  selection,
  onOpenChange,
}: {
  selection: Mode | null;
  onOpenChange: (next: Mode | null) => void;
}) {
  const open = selection !== null;
  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onOpenChange(null);
      }}
    >
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto bg-card"
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

  const { data } = useQuery({
    queryKey: ["moves"],
    queryFn: () => fetchMoves(),
  });
  const moves = data?.moves ?? [];
  const existing = selection !== "new" ? moves.find((m) => m.id === selection) : undefined;

  const sportOptions = useMemo(
    () => Array.from(new Set(moves.map((m) => m.sport).filter(Boolean))).sort(),
    [moves],
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set(moves.map((m) => m.category).filter(Boolean))).sort(),
    [moves],
  );

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

  const isNew = selection === "new" && !existing;
  const move: Partial<MoveDTO> = existing ?? draft;

  const upsertMutation = useMutation({
    mutationFn: upsertFn,
    onSuccess: ({ move: saved }) => {
      qc.invalidateQueries({ queryKey: ["moves"] });
      if (isNew) onSelect(saved.id);
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
      onSelect(res.move.id);
      toast.success("Duplicated");
    } finally {
      setSavingField(null);
    }
  };

  const archive = () => {
    if (!existing) return;
    if (!window.confirm(`Archive "${existing.name}"? You can recreate it later.`)) return;
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
            placeholder={isNew ? "Name this move to save it" : "Add a name"}
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
            disabled={isNew && !move.name}
            onCommit={(v) => commitField("sport", v)}
          />
          <MoveField
            kind="select"
            label="Category"
            value={move.category ?? ""}
            options={categoryOptions}
            placeholder="Category"
            saving={savingField === "category"}
            disabled={isNew && !move.name}
            onCommit={(v) => commitField("category", v)}
          />
        </div>

        {/* Target */}
        <TargetEditor
          kind={(move.defaultTargetKind as TargetKind) ?? "reps"}
          value={Number(move.defaultTargetValue ?? 0)}
          disabled={isNew && !move.name}
          saving={savingField === "defaultTargetKind" || savingField === "defaultTargetValue"}
          onCommit={async (k, v) => {
            if (k !== move.defaultTargetKind) await commitField("defaultTargetKind", k);
            if (v !== move.defaultTargetValue) await commitField("defaultTargetValue", v);
          }}
        />

        {/* Cue */}
        <MoveField
          kind="textarea"
          label="Cue"
          value={move.cue ?? ""}
          placeholder="One line the athlete can repeat to themselves"
          rows={2}
          saving={savingField === "cue"}
          disabled={isNew && !move.name}
          onCommit={(v) => commitField("cue", v)}
          displayClassName="font-hand text-hand text-text-primary"
          inputClassName="font-hand text-hand text-text-primary"
        />

        {/* Why */}
        <MoveField
          kind="textarea"
          label="Why this matters"
          value={move.why ?? ""}
          placeholder="What this move develops, in plain language"
          rows={3}
          saving={savingField === "why"}
          disabled={isNew && !move.name}
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
          disabled={isNew && !move.name}
          onCommit={(v) => commitField("description", v)}
        />

        {!isNew && existing ? (
          <div className="flex items-center justify-between gap-3 border-t border-divider pt-4">
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
            <Button
              type="button"
              variant="ghost"
              onClick={archive}
              disabled={archiveMutation.isPending}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Archive
            </Button>
          </div>
        ) : null}
      </div>
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
  const kindRef = useMemo(() => ({ kind, value }), [kind, value]);
  useMemoEffect(() => {
    setLocalKind(kindRef.kind);
    setLocalValue(String(kindRef.value));
  }, [kindRef]);

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
          {(["reps", "minutes"] as TargetKind[]).map((k) => (
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

// Tiny effect helper that only re-runs when the memoized object identity changes.
function useMemoEffect(fn: () => void, deps: unknown[]) {
  useMemoEffectImpl(fn, deps);
}
import { useEffect as _useEffect } from "react";
function useMemoEffectImpl(fn: () => void, deps: unknown[]) {
  _useEffect(fn, deps);
}
