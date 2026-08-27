import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  adminGetGuardianInvite,
  adminRegenerateGuardianInvite,
  adminResendGuardianInvite,
} from "@/lib/guardian-admin.functions";

async function copyText(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy — select it manually");
  }
}

/**
 * Admin controls for an athlete's parent/guardian invite: personal claim link,
 * typeable code, resend to a (possibly new) address, and regenerate.
 */
export function GuardianInviteControls({ athleteId }: { athleteId: string }) {
  const get = useServerFn(adminGetGuardianInvite);
  const resend = useServerFn(adminResendGuardianInvite);
  const regenerate = useServerFn(adminRegenerateGuardianInvite);
  const qc = useQueryClient();

  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-guardian-invite", athleteId],
    queryFn: () => get({ data: { athleteId } }),
  });

  if (isLoading) return <p className="text-sm text-text-tertiary">Loading parent invite…</p>;
  if (!data) return null;
  if (data.claimed) {
    return <p className="text-sm text-text-tertiary">Parent account already set up.</p>;
  }

  const value = email ?? data.guardianEmail ?? "";

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-guardian-invite", athleteId] });

  const onResend = async () => {
    if (!value.trim()) {
      toast.error("Add a parent or guardian email first.");
      return;
    }
    setBusy(true);
    try {
      await resend({ data: { athleteId, guardianEmail: value.trim() } });
      toast.success(`Invite sent to ${value.trim()}`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onRegenerate = async () => {
    setBusy(true);
    try {
      await regenerate({ data: { athleteId } });
      toast.success("New link and code issued");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Eyebrow size="small" tone="tertiary" weight="normal" tracking="wide">
        Parent invite
      </Eyebrow>

      {data.sameInbox && (
        <p className="rounded-md border border-divider bg-elevated px-3 py-2 text-xs text-text-secondary">
          Heads up: this invite goes to the athlete&apos;s own inbox — the guardian email on file is
          the same address they log in with. Change it below before resending.
        </p>
      )}


      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-divider bg-elevated px-3 py-2 font-mono text-sm tracking-[0.2em] text-text-primary">
          {data.claimCode ?? "—"}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!data.claimCode}
          onClick={() => copyText(data.claimCode!, "Code")}
        >
          <Copy className="size-4" aria-hidden /> Copy code
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!data.claimUrl}
          onClick={() => copyText(data.claimUrl!, "Link")}
        >
          <Copy className="size-4" aria-hidden /> Copy link
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRegenerate}>
          <RefreshCw className="size-4" aria-hidden /> New link
        </Button>
      </div>

      {data.claimUrl && (
        <p className="break-all text-xs text-text-tertiary">{data.claimUrl}</p>
      )}

      <div className="space-y-1">
        <Label htmlFor={`guardian-email-${athleteId}`}>Send invite to</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={`guardian-email-${athleteId}`}
            type="email"
            inputMode="email"
            placeholder="parent@example.com"
            className="max-w-xs"
            value={value}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="button" size="sm" disabled={busy} onClick={onResend}>
            <Send className="size-4" aria-hidden /> Send invite
          </Button>
        </div>
        {data.invitedAt && (
          <p className="text-xs text-text-tertiary">
            Last sent {new Date(data.invitedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
