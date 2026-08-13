import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveInviteCode } from "@/lib/invite-resolve.functions";
import { claimParentInvite } from "@/lib/parent-signup.functions";
import {
  claimAdultAthleteInvite,
  getAdultAthleteByInviteCode,
} from "@/lib/adult-athlete-invite.functions";
import { coachProfileQueryOptions } from "@/hooks/use-coach-profile";
import { isCoachProAvailable } from "@/lib/paywall-flag";
import {
  coachProSoonDescription,
  coachRosterFullCopy,
  isRosterFullError,
} from "@/lib/roster-limits";

/**
 * Coach-side "enter a code" card. Lets a coach paste a parent or adult-athlete
 * invite code (given to them in person / by text) to link that person's
 * athlete(s) onto their roster without needing the shareable link.
 */
export function EnterInviteCodeCard({
  onSuccess,
  hideIntro = false,
}: { onSuccess?: () => void; hideIntro?: boolean } = {}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const resolveFn = useServerFn(resolveInviteCode);
  const previewAdultFn = useServerFn(getAdultAthleteByInviteCode);
  const claimParentFn = useServerFn(claimParentInvite);
  const claimAdultFn = useServerFn(claimAdultAthleteInvite);
  const { data: coachProfile } = useQuery(coachProfileQueryOptions);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const codeValid = /^[A-Z2-9]{8}$/.test(code.trim().toUpperCase());

  const reset = () => setCode("");

  const handleSubmit = async () => {
    const normalized = code.trim().toUpperCase();
    setBusy(true);
    try {
      const resolved = await resolveFn({ data: { code: normalized } });
      if (!resolved.kind || !resolved.valid) {
        toast.error("That code isn't valid.");
        return;
      }
      if (resolved.kind === "coach") {
        toast.error("That's another coach's invite code — you can't add it to your roster.");
        return;
      }
      if (resolved.kind === "athlete") {
        toast.error("That's a new-athlete signup code, not a roster invite.");
        return;
      }
      if (resolved.kind === "parent") {
        const res = await claimParentFn({ data: { code: normalized } });
        toast.success(
          res.athletes === 0
            ? "Linked to the parent (no athletes on their account yet)"
            : `Added ${res.athletes} athlete${res.athletes === 1 ? "" : "s"} to your roster`,
        );
      } else {
        // adult-athlete: preview the name for a nicer toast, then claim.
        const preview = await previewAdultFn({ data: { code: normalized } }).catch(() => null);
        await claimAdultFn({ data: { code: normalized } });
        const name = preview ? `${preview.firstName} ${preview.lastName}`.trim() : "athlete";
        toast.success(`Added ${name} to your roster`);
      }
      qc.invalidateQueries();
      reset();
      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't add to roster";
      if (/already/i.test(msg)) {
        toast.success("Already on your roster");
        reset();
        onSuccess?.();
      } else if (isRosterFullError(err)) {
        const limit = coachProfile?.profile.athleteLimit ?? 25;
        const current = coachProfile?.profile.athleteCount ?? limit;
        const copy = coachRosterFullCopy(current, limit);
        if (isCoachProAvailable()) {
          toast.error(copy.title, {
            description: copy.description,
            action: {
              label: "Upgrade",
              onClick: () => navigate({ to: "/coach/paywall", search: { tier: "coach_pro" } }),
            },
          });
        } else {
          toast.error(copy.title, {
            description: `You're at ${current} of ${limit} athletes. ${coachProSoonDescription}`,
          });
        }
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {hideIntro ? null : (
        <div className="text-xs text-text-secondary">
          Got a code from a parent or an adult athlete? Enter it here to add them to your roster.
        </div>
      )}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (codeValid && !busy) void handleSubmit();
        }}
      >
        <div className="space-y-1.5">
          <Label className="text-xs">Their invite code</Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            placeholder="––––––––"
            className="text-center font-mono text-lg tracking-[0.3em] uppercase"
            autoComplete="off"
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" type="submit" disabled={!codeValid || busy}>
            {busy ? "Adding…" : "Add to roster"}
          </Button>
        </div>
      </form>
    </div>
  );
}
