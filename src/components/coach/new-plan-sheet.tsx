import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createPlan, listCoachAthletes } from "@/lib/plans.functions";

type Mode = "plan" | "template";

export function NewPlanSheet({
  open,
  onOpenChange,
  initialAthleteId,
  initialMode = "plan",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAthleteId?: string;
  initialMode?: Mode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto border-t border-divider shadow-page"
        style={{ backgroundColor: "var(--popover)", backgroundImage: "none" }}
      >
        {open ? (
          <Body
            initialAthleteId={initialAthleteId ?? ""}
            initialMode={initialMode}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({
  initialAthleteId,
  initialMode,
  onClose,
}: {
  initialAthleteId: string;
  initialMode: Mode;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const createFn = useServerFn(createPlan);
  const fetchAthletes = useServerFn(listCoachAthletes);

  const { data } = useQuery({
    queryKey: ["coach-athletes"],
    queryFn: () => fetchAthletes(),
  });
  const athletes = data?.athletes ?? [];

  const [mode, setMode] = useState<Mode>(initialMode);
  const [title, setTitle] = useState("");
  const [athleteId, setAthleteId] = useState(initialAthleteId);

  const mutation = useMutation({
    mutationFn: createFn,
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      onClose();
      navigate({ to: "/coach/plans/$planId", params: { planId: id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSave =
    !mutation.isPending && (mode === "template" || Boolean(athleteId));

  const save = () => {
    if (!canSave) return;
    const cleanTitle = title.trim() || (mode === "template" ? "Untitled template" : "Untitled plan");
    if (mode === "template") {
      mutation.mutate({ data: { kind: "template", title: cleanTitle } });
    } else {
      mutation.mutate({ data: { kind: "plan", athleteId, title: cleanTitle } });
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-display text-2xl">New plan</SheetTitle>
      </SheetHeader>

      <div className="mt-5 space-y-5">
        {/* Mode toggle */}
        <div>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-text-tertiary">
            For
          </p>
          <div className="inline-flex overflow-hidden rounded-md border border-divider">
            {(["plan", "template"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition",
                  mode === m
                    ? "bg-accent text-accent-foreground"
                    : "bg-card text-text-secondary hover:text-text-primary",
                )}
              >
                {m === "plan" ? "Athlete" : "Template"}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-text-tertiary">
            Title
          </p>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={mode === "template" ? "Template name" : "Plan name"}
            autoFocus
            className="font-display text-lg font-bold"
          />
        </div>

        {/* Athlete picker (plan mode only) */}
        {mode === "plan" ? (
          <div>
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-text-tertiary">
              Athlete
            </p>
            {athletes.length === 0 ? (
              <p className="text-sm text-text-secondary">
                No athletes on your roster yet. Create a template instead.
              </p>
            ) : (
              <select
                value={athleteId}
                onChange={(e) => setAthleteId(e.target.value)}
                className="h-9 w-full rounded-md border border-divider bg-card px-2 text-sm font-medium text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="">Pick an athlete…</option>
                {athletes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-divider pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={!canSave}>
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>
    </>
  );
}
