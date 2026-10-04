import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getMyParentVerification,
  startMyParentVerification,
} from "@/lib/guardian-verification.functions";

export const PARENT_VERIFICATION_QUERY_KEY = ["parent-verification"] as const;

/**
 * "Verify you're an adult" (PRD §6.13 A1–A2): the step every parent of a
 * minor passes once. Sends the KWS email, then waits for the webhook or the
 * `/verified` redirect to land, polling the status. Calls `onVerified` as
 * soon as the parent is verified, or immediately when the regime switch is
 * off (nothing to do) so callers can drop it into any flow unconditionally.
 *
 * `optional` is the opt-in mode for parent Settings while the switch is off:
 * the step stays visible until the parent is actually verified, so a parent
 * can verify ahead of the gates (and so the KWS test environment can be
 * exercised on production before `PARENT_VERIFICATION_REQUIRED` is set).
 */
export function ParentVerificationStep({
  onVerified,
  athleteName,
  compact = false,
  optional = false,
}: {
  onVerified: () => void;
  /** Used in the copy when known ("before you can connect a coach to Rory"). */
  athleteName?: string | null;
  /** Card styling for Settings; the default is the sign-up wizard's bare layout. */
  compact?: boolean;
  /** Show until verified even when the switch is off (parent Settings opt-in). */
  optional?: boolean;
}) {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getMyParentVerification);
  const start = useServerFn(startMyParentVerification);
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const fired = useRef(false);

  const { data: verification, isLoading } = useQuery({
    queryKey: PARENT_VERIFICATION_QUERY_KEY,
    queryFn: () => fetchStatus(),
    refetchInterval: (query) => {
      const v = query.state.data;
      if (!v || v.verified) return false;
      if (!optional && !v.required) return false;
      return v.requestedAt ? 5000 : false;
    },
  });

  const done = !!verification && (verification.verified || (!optional && !verification.required));

  useEffect(() => {
    if (done && !fired.current) {
      fired.current = true;
      onVerified();
    }
  }, [done, onVerified]);

  useEffect(() => {
    if (!sentAt) return;
    const tick = () => setCooldown(Math.max(0, 60 - Math.floor((Date.now() - sentAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  const handleSend = async () => {
    setSending(true);
    try {
      const result = await start();
      if (result.status === "already_verified") {
        await qc.invalidateQueries({ queryKey: PARENT_VERIFICATION_QUERY_KEY });
        return;
      }
      if (result.status === "not_configured") {
        toast.error("Verification isn't switched on yet", {
          description: "Please try again later or contact support.",
        });
        return;
      }
      if (result.status === "rate_limited") {
        toast.error("Too many attempts", {
          description: "Give it an hour, then send the link again.",
        });
        return;
      }
      setSentAt(Date.now());
      await qc.invalidateQueries({ queryKey: PARENT_VERIFICATION_QUERY_KEY });
    } catch (e) {
      toast.error("Couldn't send the link", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setSending(false);
    }
  };

  if (isLoading || !verification || done) return null;

  const waiting = Boolean(verification.requestedAt) || sentAt !== null;
  const wrapper = compact ? "rounded-xl border border-divider bg-elevated p-4" : "space-y-5";

  return (
    <section className={wrapper} aria-labelledby="verify-adult-heading">
      <div className={compact ? "flex items-start gap-3" : "text-center"}>
        {compact ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent-ink" /> : null}
        <div className={compact ? "min-w-0" : ""}>
          <p
            id="verify-adult-heading"
            className={
              compact ? "text-sm font-semibold" : "font-display text-2xl text-text-primary"
            }
          >
            Verify you&apos;re an adult
          </p>
          <p
            className={
              compact ? "mt-1 text-xs text-text-secondary" : "mt-2 text-sm text-text-secondary"
            }
          >
            {optional
              ? "Soon, every parent of an athlete under 18 confirms once that they're an adult before connecting a coach or opening a conversation. You can do it now so nothing pauses later."
              : athleteName
                ? `Before you can connect a coach to ${athleteName} or open their conversations, we confirm once that you're an adult.`
                : "Before you can connect a coach or open a conversation for an athlete under 18, we confirm once that you're an adult."}{" "}
            {optional
              ? "Our partner Kids Web Services runs a quick check; Gradus sees only the result."
              : "Our partner Kids Web Services does the check with a payment card or the last four digits of your Social Security number, on its own secure page. Gradus never sees those details, only the result."}
          </p>
        </div>
      </div>

      {!verification.available ? (
        <p className={compact ? "mt-3 text-xs text-attention-ink" : "text-sm text-attention-ink"}>
          Verification isn&apos;t switched on for this environment yet. Please try again later.
        </p>
      ) : waiting ? (
        <div className={compact ? "mt-3 space-y-2" : "space-y-3"}>
          <p
            className={compact ? "text-xs text-text-secondary" : "text-sm text-text-secondary"}
            role="status"
          >
            Check your email for the verification link. This page updates on its own the moment you
            finish.
          </p>
          <Button
            variant="outline"
            className={compact ? "" : "w-full"}
            size={compact ? "sm" : "default"}
            onClick={handleSend}
            disabled={sending || cooldown > 0}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : sending ? "Sending…" : "Resend the link"}
          </Button>
        </div>
      ) : (
        <Button
          className={compact ? "mt-3" : "w-full"}
          size={compact ? "sm" : "default"}
          onClick={handleSend}
          disabled={sending}
        >
          {sending ? "Sending…" : "Email me the verification link"}
        </Button>
      )}
    </section>
  );
}
