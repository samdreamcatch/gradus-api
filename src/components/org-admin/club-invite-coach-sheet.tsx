import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createOrgCoachInvite } from "@/lib/org-admin.functions";
import { SPORTS } from "@/lib/coach-sports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

const chip = (on: boolean) =>
  "press-soft min-h-9 rounded-pill border px-3 text-sm " +
  (on
    ? "border-accent bg-accent text-accent-foreground"
    : "border-divider bg-card text-text-primary");

/** Invite a coach by email with the sports (and optional levels) they coach. */
export function ClubInviteCoachSheet({
  open,
  onOpenChange,
  orgId,
  orgName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  orgName: string;
}) {
  const create = useServerFn(createOrgCoachInvite);
  const qc = useQueryClient();
  const mobile = useIsMobile();
  const [email, setEmail] = useState("");
  const [sports, setSports] = useState<string[]>([]);
  const [levels, setLevels] = useState<{ sport: string; levelKey: string }[]>([]);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const invite = useMutation({
    mutationFn: () =>
      create({ data: { organizationId: orgId, email: email.trim(), sports, levels } }),
    onSuccess: (res) => {
      toast.success(
        res.emailed ? `Invite emailed — code ${res.code}` : `Invite created — code ${res.code}`,
      );
      setEmail("");
      setSports([]);
      setLevels([]);
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={
          mobile
            ? "paper-surface max-h-[90dvh] overflow-y-auto p-6 font-sans"
            : "w-full overflow-y-auto p-6 font-sans sm:max-w-md"
        }
      >
        <SheetHeader>
          <SheetTitle className="font-display text-h2 [&_span]:font-display">
            Invite a coach
          </SheetTitle>
          <SheetDescription className="sr-only">
            Invite a coach by email with the sports they coach.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <div className="space-y-1">
            <Label htmlFor="inv-email">Email</Label>
            <Input
              className="min-h-11"
              id="inv-email"
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="coach@example.com"
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-text-primary">Sports</legend>
            <p className="text-meta text-text-secondary">Choose the sports they coach.</p>
            <div className="flex flex-wrap gap-2">
              {SPORTS.map((sp) => {
                const on = sports.includes(sp.key);
                return (
                  <button
                    key={sp.key}
                    type="button"
                    aria-pressed={on}
                    className={chip(on)}
                    onClick={() => {
                      setSports((cur) => (on ? cur.filter((k) => k !== sp.key) : [...cur, sp.key]));
                      if (on) setLevels((cur) => cur.filter((l) => l.sport !== sp.key));
                    }}
                  >
                    {sp.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {sports.map((key) => {
            const sp = SPORTS.find((x) => x.key === key);
            if (!sp) return null;
            return (
              <fieldset key={key} className="space-y-2">
                <legend className="text-sm font-medium text-text-primary">
                  {sp.label} levels <span className="text-text-tertiary">(optional)</span>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {sp.levels.map((lv) => {
                    const on = levels.some((l) => l.sport === key && l.levelKey === lv.key);
                    return (
                      <button
                        key={lv.key}
                        type="button"
                        aria-pressed={on}
                        className={chip(on)}
                        onClick={() =>
                          setLevels((cur) =>
                            on
                              ? cur.filter((l) => !(l.sport === key && l.levelKey === lv.key))
                              : [...cur, { sport: key, levelKey: lv.key }],
                          )
                        }
                      >
                        {lv.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
          <p className="text-meta text-text-secondary">
            They&apos;ll get an email with an 8-character code to join {orgName || "your club"}.
            Levels you pick are added to their profile when they accept.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-11 flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className="min-h-11 flex-1 press"
              onClick={() => invite.mutate()}
              disabled={invite.isPending || !emailValid || sports.length === 0}
            >
              {invite.isPending ? "Sending…" : "Send invite"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
