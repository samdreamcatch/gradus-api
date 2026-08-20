import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { startImpersonation } from "@/lib/impersonation.functions";
import { markImpersonating } from "@/lib/impersonation";
import { Chip } from "@/components/ui/chip";

/**
 * Swaps the current admin session for a one-time-token session as `userId`.
 * The admin session is replaced in this browser, so we warn first.
 */
export function ImpersonateButton({
  userId,
  email,
  onStarted,
}: {
  userId: string;
  email: string;
  onStarted?: () => void;
}) {
  const start = useServerFn(startImpersonation);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (
      !confirm(
        `Sign in as ${email || "this user"}?\n\nThis replaces your admin session in this browser and is audit-logged. You'll need to sign back in as yourself afterwards.`,
      )
    )
      return;
    setBusy(true);
    try {
      const { tokenHash, email: targetEmail, home } = await start({ data: { userId } });
      onStarted?.();
      await supabase.auth.signOut();
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "magiclink",
      });
      if (error) throw error;
      markImpersonating(targetEmail);
      // Full reload so every cached query and router context is rebuilt
      // for the impersonated user.
      window.location.assign(home);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the session");
      setBusy(false);
    }
  };

  return (
    <Chip as="button" tone="muted" disabled={busy} className="disabled:opacity-50" onClick={run}>
      {busy ? "Starting…" : "Sign in as user"}
    </Chip>
  );
}
