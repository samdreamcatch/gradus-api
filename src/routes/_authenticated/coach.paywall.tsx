import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Building2, Check, ArrowLeft } from "lucide-react";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { coachProfileQueryOptions } from "@/hooks/use-coach-profile";
import { clearOrganizationLink } from "@/lib/coach-org.functions";
import { startCoachCheckout } from "@/lib/coach-checkout.functions";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { supabase } from "@/integrations/supabase/client";
import { isCoachPaywallEnabled } from "@/lib/paywall-flag";

type Tier = "coach" | "coach_pro";
type Interval = "month" | "year";

const PRICE_MAP: Record<Tier, Record<Interval, {
  priceId: "coach_monthly" | "coach_yearly" | "coach_pro_monthly" | "coach_pro_yearly";
  monthlyEquivalent: number;
  billed: string;
}>> = {
  coach: {
    month: { priceId: "coach_monthly", monthlyEquivalent: 40, billed: "$40/mo, billed monthly" },
    year: { priceId: "coach_yearly", monthlyEquivalent: 34, billed: "$408/yr — save 15%" },
  },
  coach_pro: {
    month: { priceId: "coach_pro_monthly", monthlyEquivalent: 70, billed: "$70/mo, billed monthly" },
    year: { priceId: "coach_pro_yearly", monthlyEquivalent: 59.5, billed: "$714/yr — save 15%" },
  },
};

const FEATURES: Record<Tier, string[]> = {
  coach: [
    "Full coaching workspace",
    "Roster, plans, and messaging",
    "Athlete & parent portals",
    "Up to 25 athletes",
  ],
  coach_pro: [
    "Everything in Coach",
    "Advanced scheduling",
    "Multi-coach visibility",
    "Up to 75 athletes",
    "Priority support",
  ],
};

export const Route = createFileRoute("/_authenticated/coach/paywall")({
  validateSearch: (search: Record<string, unknown>) => ({
    checkout: typeof search.checkout === "string" ? search.checkout : undefined,
    tier: typeof search.tier === "string" ? search.tier : undefined,
  }),
  beforeLoad: () => {
    // Paywall kill-switch: while disabled, this URL is dead — bounce back
    // into the app. Founding coaches are grandfathered in via onboarding.
    
    if (!isCoachPaywallEnabled()) {
      throw redirect({ to: "/coach/roster" });
    }
  },
  component: PaywallPage,
});

function PaywallPage() {
  const { data } = useQuery(coachProfileQueryOptions);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clearOrg = useServerFn(clearOrganizationLink);
  const checkoutFn = useServerFn(startCoachCheckout);
  const { checkout: checkoutStatus, tier: preselectedTier } = Route.useSearch();

  const [interval, setInterval] = useState<Interval>("year");
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const entitlement = data?.profile.entitlement ?? "pending";

  // Poll for entitlement flip after returning from Stripe.
  useEffect(() => {
    if (checkoutStatus !== "return") return;
    const iv = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["coach-profile"] });
    }, 2000);
    return () => window.clearInterval(iv);
  }, [checkoutStatus, qc]);

  const isEntitled =
    entitlement === "paid" ||
    entitlement === "promo_free" ||
    entitlement === "club_covered";

  useEffect(() => {
    if (isEntitled) navigate({ to: "/coach/roster", replace: true });
  }, [isEntitled, navigate]);

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };


  const startCheckout = useCallback(
    async (tier: Tier) => {
      setLoading(true);
      setSelectedTier(tier);
      try {
        const env = getStripeEnvironment();
        const returnUrl = `${window.location.origin}/coach/paywall?checkout=return`;
        const result = await checkoutFn({
          data: {
            priceId: PRICE_MAP[tier][interval].priceId,
            environment: env,
            returnUrl,
          },
        });
        if ("error" in result) throw new Error(result.error);
        if (!result.clientSecret) throw new Error("No checkout session returned");
        setClientSecret(result.clientSecret);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't start checkout");
        setSelectedTier(null);
      } finally {
        setLoading(false);
      }
    },
    [checkoutFn, interval],
  );

  const options = useMemo(
    () => (clientSecret ? { fetchClientSecret: async () => clientSecret } : null),
    [clientSecret],
  );

  if (isEntitled) return null;


  if (clientSecret && options) {
    return (
      <div className="min-h-dvh">
        <PaymentTestModeBanner />
        <div className="mx-auto max-w-2xl px-4 py-6">
          <button
            type="button"
            onClick={() => {
              setClientSecret(null);
              setSelectedTier(null);
            }}
            className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary underline-offset-2 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back to plans
          </button>
          <div id="checkout" className="overflow-hidden rounded-2xl bg-card shadow-card">
            <EmbeddedCheckoutProvider stripe={getStripe()} options={options}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <PaymentTestModeBanner />
      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-5">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
          <Sparkles className="h-5 w-5" />
        </div>
        <h1 className="text-center font-display text-h2 text-text-primary">
          Get your first 3 months free
        </h1>
        <p className="mt-1.5 max-w-md text-center text-sm text-text-secondary">
          Pick a plan to activate your workspace. You won't be charged until your
          trial ends — cancel anytime.
        </p>

        <div className="mt-4 inline-flex rounded-full border border-divider bg-elevated p-1 text-sm">
          {(["month", "year"] as const).map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              className={cn(
                "rounded-full px-4 py-1.5 press-soft",
                interval === iv
                  ? "bg-card text-text-primary shadow-sm"
                  : "text-text-secondary",
              )}
            >
              {iv === "month" ? "Monthly" : "Yearly"}
              {iv === "year" && (
                <span className="ml-1 text-xs text-accent-ink">save 15%</span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-4 grid w-full grid-cols-2 gap-3">
          {(Object.keys(PRICE_MAP) as Tier[]).map((tier) => {
            const price = PRICE_MAP[tier][interval];
            const isPro = tier === "coach_pro";
            return (
              <div
                key={tier}
                className={cn(
                  "flex flex-col rounded-2xl border p-3 shadow-card sm:p-4",
                  isPro
                    ? "border-accent/60 bg-card"
                    : "border-divider bg-card",
                )}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <h2 className="font-display text-lg text-text-primary sm:text-h3">
                    {isPro ? "Coach Pro" : "Coach"}
                  </h2>
                  {isPro && (
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-ink sm:text-[10px] sm:tracking-widest">
                      SOON
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-display text-2xl text-text-primary tabular-nums sm:text-4xl">
                    ${price.monthlyEquivalent}
                  </span>
                  <span className="text-xs text-text-secondary sm:text-sm">/ mo</span>
                </div>
                <p className="mt-1 text-[11px] text-text-tertiary sm:text-xs">{price.billed}</p>

                <ul className="mt-3 space-y-1.5 text-xs text-text-secondary sm:text-sm">
                  {FEATURES[tier].map((f) => (
                    <li key={f} className="flex items-start gap-1.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-ink sm:h-4 sm:w-4" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  type="button"
                  className="mt-4 w-full text-xs sm:text-sm"
                  disabled={loading || isPro}
                  onClick={() => startCheckout(tier)}
                >
                  {isPro
                    ? "Coming soon"
                    : loading && selectedTier === tier
                    ? "Starting…"
                    : "Start free trial"}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="mt-5 w-full rounded-xl border border-divider bg-elevated p-3">
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
            <div className="text-sm">
              <p className="font-semibold text-text-primary">
                Joining through a club?
              </p>
              <p className="mt-1 text-text-secondary">
                If your academy or association is a Gradus partner, they can
                cover your subscription.
              </p>
              <Link
                to="/coach/settings"
                className="mt-2 inline-block text-accent-ink underline underline-offset-2"
              >
                Enter club code in Settings →
              </Link>
            </div>
          </div>
        </div>

        {data?.profile.organizationId && (
          <div className="mt-4 text-center">
            <button
              type="button"
              className="text-xs text-text-tertiary underline underline-offset-2"
              onClick={async () => {
                try {
                  await clearOrg();
                  await qc.invalidateQueries({ queryKey: ["coach-profile"] });
                  toast.success("Club link removed");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Couldn't unlink");
                }
              }}
            >
              Unlink from current club
            </button>
          </div>
        )}

        <div className="mt-5 border-t border-divider pt-3 text-center">
          <button
            type="button"
            onClick={handleSignOut}
            className="text-xs text-text-tertiary underline underline-offset-2"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
