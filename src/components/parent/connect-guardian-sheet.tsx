import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { inviteGuardian } from "@/lib/team-guardians.functions";

type Athlete = { id: string; firstName: string; lastName: string };

/**
 * "Add a guardian" sheet — mirrors ConnectCoachSheet. Creates a guardian
 * invite for one athlete, optionally emailing it, and shows the code to share.
 */
export function ConnectGuardianSheet({
  athletes,
  disabled = false,
}: {
  athletes: Athlete[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [athleteId, setAthleteId] = useState<string>(athletes[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const vv = useVisualViewport();
  const qc = useQueryClient();
  const invite = useServerFn(inviteGuardian);

  const mutation = useMutation({
    mutationFn: (vars: { athleteId: string; email: string | null }) =>
      invite({ data: { athleteId: vars.athleteId, email: vars.email } }),
    onSuccess: (res: { code: string }) => {
      setCode(res.code);
      setEmail("");
      toast.success("Invite created");
      void qc.invalidateQueries({ queryKey: ["team-guardians"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Couldn't create the invite.");
    },
  });

  const reset = () => {
    setCode(null);
    setEmail("");
    setAthleteId(athletes[0]?.id ?? "");
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={disabled}>
          <Plus className="size-3.5" aria-hidden /> Add a guardian
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="paper-surface overflow-y-auto"
        style={{ bottom: vv.keyboardInset, maxHeight: Math.round(vv.height * 0.9) }}
      >
        <SheetHeader>
          <SheetTitle>Add a parent or guardian</SheetTitle>
          <SheetDescription>
            They&apos;ll get full access to this athlete. Up to 3 guardians per athlete.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {athletes.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="guardian-athlete">Athlete</Label>
              <Select value={athleteId} onValueChange={setAthleteId}>
                <SelectTrigger id="guardian-athlete">
                  <SelectValue placeholder="Choose an athlete" />
                </SelectTrigger>
                <SelectContent>
                  {athletes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.firstName} {a.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {code ? (
            <div className="rounded-xl border border-divider bg-elevated p-4">
              <p className="text-xs text-text-secondary">Share this code with them</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="font-mono text-lg font-bold tracking-widest text-text-primary">
                  {code}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(code);
                    toast.success("Code copied");
                  }}
                >
                  <Copy className="size-3.5" aria-hidden /> Copy
                </Button>
              </div>
              <Button type="button" className="mt-4 w-full" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="guardian-email">Their email (optional)</Label>
                <Input
                  id="guardian-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  placeholder="coparent@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <p className="text-xs text-text-tertiary">
                  We&apos;ll email them the invite. Leave blank to just get a code to share.
                </p>
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={!athleteId || mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    athleteId,
                    email: email.trim() ? email.trim() : null,
                  })
                }
              >
                {mutation.isPending ? "Creating…" : "Create invite"}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
