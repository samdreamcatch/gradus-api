import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, Landmark } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/native";
import {
  getStripeConnectStatusFn,
  openStripeConnectDashboardFn,
  startStripeConnectOnboardingFn,
} from "@/lib/stripe-connect.functions";
import type { StripeConnectState } from "@/lib/stripe-connect.server";

const QUERY_KEY = ["coach", "stripe-connect"] as const;

/** `?stripe=return` / `?stripe=refresh`: where Stripe sends the coach back after onboarding. */
type StripeReturn = "return" | "refresh" | null;

function readStripeReturn(): StripeReturn {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("stripe");
  return value === "return" || value === "refresh" ? value : null;
}

function clearStripeReturn() {
  const url = new URL(window.location.href);
  url.searchParams.delete("stripe");
  window.history.replaceState(window.history.state, "", url.toString());
}

const PILL: Record<
  StripeConnectState,
  { label: string; tone: "accent" | "muted" | "destructive" }
> = {
  not_connected: { label: "Not connected", tone: "muted" },
  pending: { label: "Setup incomplete", tone: "muted" },
  restricted: { label: "Action needed", tone: "destructive" },
  active: { label: "Connected", tone: "accent" },
};

const DESCRIPTION: Record<StripeConnectState, string> = {
  not_connected: "Connect a Stripe account to get paid for the plans you sell in the Marketplace.",
  pending: "You started connecting Stripe. Finish the form so buyers can pay you.",
  restricted: "Stripe needs more details before it can pay you out.",
  active: "Payments for your Marketplace plans go to your Stripe account.",
};

/**
 * Coach settings → Payouts: connect a Stripe Express account (Stripe Connect)
 * so plan sales can be paid out to the coach. Onboarding and the dashboard
 * open on Stripe's own pages via `openExternal` (never inside the app's
 * webview); Stripe sends the coach back to `/coach/settings?stripe=return`,
 * which re-reads the account from Stripe.
 */
export function StripeConnectSection() {
  const queryClient = useQueryClient();
  const getStatus = useServerFn(getStripeConnectStatusFn);
  const startOnboarding = useServerFn(startStripeConnectOnboardingFn);
  const openDashboard = useServerFn(openStripeConnectDashboardFn);
  const [stripeReturn] = useState<StripeReturn>(readStripeReturn);
  const [busy, setBusy] = useState<"onboarding" | "dashboard" | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: QUERY_KEY,
    // Back from Stripe: ask Stripe now rather than wait for the webhook.
    queryFn: () => getStatus({ data: { refresh: stripeReturn !== null } }),
  });

  useEffect(() => {
    if (!stripeReturn) return;
    clearStripeReturn();
    if (stripeReturn === "refresh") toast("That Stripe link expired. Tap the button to continue.");
  }, [stripeReturn]);

  const connect = async () => {
    setBusy("onboarding");
    try {
      const settingsUrl = `${window.location.origin}/coach/settings`;
      const res = await startOnboarding({
        data: {
          returnUrl: `${settingsUrl}?stripe=return`,
          refreshUrl: `${settingsUrl}?stripe=refresh`,
        },
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      void openExternal(res.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open Stripe");
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }
  };

  const dashboard = async () => {
    setBusy("dashboard");
    try {
      const res = await openDashboard();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      void openExternal(res.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open your Stripe dashboard");
    } finally {
      setBusy(null);
    }
  };

  const status: StripeConnectState = data?.status ?? "not_connected";
  const pill = PILL[status];
  const toneClass =
    pill.tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : pill.tone === "muted"
        ? "bg-elevated text-text-secondary"
        : "bg-accent/10 text-accent-ink";

  return (
    <>
      <div className="rounded-2xl border border-divider bg-elevated/60 px-4 py-4 backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <Landmark className="mt-0.5 size-4 shrink-0 text-text-secondary" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate font-display text-base text-text-primary">Stripe</div>
              {!isLoading && !isError && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                    toneClass,
                  )}
                >
                  {pill.label}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              {isLoading
                ? "Checking your Stripe account…"
                : isError
                  ? "Couldn't check your Stripe account. Try again in a moment."
                  : DESCRIPTION[status]}
            </p>
          </div>
        </div>
      </div>

      {/* Same small outline button as Coaching → "Connect" (ConnectPeopleSheet). */}
      {!isLoading && !isError && (
        <div className="mt-3 flex flex-wrap gap-2">
          {status !== "active" && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void connect()}
              disabled={busy !== null}
            >
              <Landmark className="size-3.5" aria-hidden />
              {busy === "onboarding"
                ? "Opening Stripe…"
                : status === "not_connected"
                  ? "Connect Stripe"
                  : status === "pending"
                    ? "Finish connecting"
                    : "Update details"}
            </Button>
          )}
          {(status === "active" || status === "restricted") && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void dashboard()}
              disabled={busy !== null}
            >
              <ExternalLink className="size-3.5" aria-hidden />
              {busy === "dashboard" ? "Opening Stripe…" : "Stripe dashboard"}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
