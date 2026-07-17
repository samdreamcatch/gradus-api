import { createFileRoute, Outlet, redirect, isRedirect, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { requireRole } from "@/lib/role-guard";
import { coachProfileQueryOptions } from "@/hooks/use-coach-profile";
import { ConnectionCelebration } from "@/components/connection-celebration";
import { createCoachBillingPortalSession } from "@/lib/coach-checkout.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { Button } from "@/components/ui/button";

const ENTITLED = new Set(["paid", "promo_free", "club_covered"]);

export const Route = createFileRoute("/_authenticated/coach")({
  beforeLoad: async ({ context, location }) => {
    await requireRole("coach", context.queryClient);

    // Onboarding step & paywall itself are always reachable so the coach
    // can finish signup / see why access is blocked.
    const path = location.pathname;
    if (path.startsWith("/coach/onboarding") || path.startsWith("/coach/paywall")) {
      return;
    }

    let data;
    try {
      data = await context.queryClient.ensureQueryData(coachProfileQueryOptions);
    } catch (err) {
      // Re-throw redirects (e.g. auth) but swallow transient fetch failures so
      // downstream loaders can surface their own errors.
      if (isRedirect(err)) throw err;
      return;
    }
    if (!data.profile.onboardedAt) {
      throw redirect({ to: "/coach/onboarding" });
    }
    if (!ENTITLED.has(data.profile.entitlement)) {
      throw redirect({ to: "/coach/paywall" });
    }
  },
  component: CoachLayout,
});

function CoachLayout() {
  return (
    <>
      <PaymentIssueBanner />
      <Outlet />
      <ConnectionCelebration role="coach" />
    </>
  );
}

/**
 * Sits above coach content when Stripe reports the subscription is past_due —
 * the coach still has access during Stripe's retry window, but their card
 * needs updating before those retries run out.
 */
function PaymentIssueBanner() {
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(coachProfileQueryOptions);
  const portal = useServerFn(createCoachBillingPortalSession);
  const [busy, setBusy] = useState(false);

  if (data.profile.subscriptionStatus !== "past_due") return null;

  const openPortal = async () => {
    setBusy(true);
    try {
      const res = await portal({
        data: {
          environment: getStripeEnvironment(),
          returnUrl: window.location.href,
        },
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open billing portal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" />
          Your last payment failed. Update your card to keep coaching.
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void openPortal()}
            disabled={busy}
          >
            {busy ? "Opening…" : "Update card"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate({ to: "/coach/settings" })}
          >
            Settings
          </Button>
        </div>
      </div>
    </div>
  );
}
