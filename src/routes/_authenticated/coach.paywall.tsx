import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Building2, Check, ArrowLeft, Tag, Loader2 } from "lucide-react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import { coachProfileQueryOptions } from "@/hooks/use-coach-profile";
import {
  claimOrganizationInviteCode,
  clearOrganizationLink,
  recordSilentClubLead,
} from "@/lib/coach-org.functions";
import { startCoachCheckout, changeCoachSubscription, verifyCheckoutSession, claimFoundingCoachTier } from "@/lib/coach-checkout.functions";
import { validatePromoCode } from "@/lib/promo-codes.functions";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { supabase } from "@/integrations/supabase/client";
import { isCoachPaywallEnabled } from "@/lib/paywall-flag";
import {
  OrgSearchCombobox,
  type OrgOption,
} from "@/components/onboarding/org-search-combobox";
import { OrgCodeField } from "@/components/onboarding/org-code-field";

type Tier = "coach" | "coach_pro";
type Interval = "month" | "year";

const PRICE_MAP: Record<
  Tier,
  Record<
    Interval,
    {
      priceId: "coach_monthly" | "coach_yearly" | "coach_pro_monthly" | "coach_pro_yearly";
      monthlyEquivalent: number;
      billed: string;
    }
  >
> = {
  coach: {
    month: { priceId: "coach_monthly", monthlyEquivalent: 30, billed: "$30/mo, billed monthly" },
    year: { priceId: "coach_yearly", monthlyEquivalent: 25.5, billed: "$306/yr — save 15%" },
  },
  coach_pro: {
    month: { priceId: "coach_pro_monthly", monthlyEquivalent: 70, billed: "$70/mo, billed monthly" },
    year: { priceId: "coach_pro_yearly", monthlyEquivalent: 59.5, billed: "$714/yr — save 15%" },
  },
};

const FEATURES: Record<Tier, string[]> = {
  coach: ["Full coaching workspace", "Roster, plans, and messaging", "Athlete & parent portals", "Up to 5 athletes"],
  coach_pro: ["Everything in Coach", "Multi-sport", "Custom resource library", "Up to 50 athletes", "Priority support"],
};

type PromoState =
  | { status: "idle" }
  | { status: "validating" }
  | {
      status: "valid";
      code: string;
      label: string;
      durationInMonths: number | null;
      duration: "forever" | "repeating";
    }
  | { status: "invalid"; message: string };

export const Route = createFileRoute("/_authenticated/coach/paywall")({
  validateSearch: (search: Record<string, unknown>) => ({
    checkout: typeof search.checkout === "string" ? search.checkout : undefined,
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
    tier: typeof search.tier === "string" ? search.tier : undefined,
    manage: search.manage === true || search.manage === "true" ? true : undefined,
  }),

  beforeLoad: () => {
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
  const claimClub = useServerFn(claimOrganizationInviteCode);
  const recordLead = useServerFn(recordSilentClubLead);
  const checkoutFn = useServerFn(startCoachCheckout);
  const changeSubFn = useServerFn(changeCoachSubscription);
  const verifyCheckoutFn = useServerFn(verifyCheckoutSession);
  const claimFoundingFn = useServerFn(claimFoundingCoachTier);
  const validateCode = useServerFn(validatePromoCode);
  const {
    checkout: checkoutStatus,
    session_id: returnedSessionId,
    tier: preselectedTier,
    manage: manageIntent,
  } = Route.useSearch();

  const [interval, setInterval] = useState<Interval>("year");
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [promoOpen, setPromoOpen] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState<PromoState>({ status: "idle" });

  const [clubOrg, setClubOrg] = useState<OrgOption | null>(null);
  const [clubCode, setClubCode] = useState("");
  const [clubCodeVerified, setClubCodeVerified] = useState(false);
  const [claimingClub, setClaimingClub] = useState(false);
  
  const tiersDisabled = clubOrg !== null;

  const entitlement = data?.profile.entitlement ?? "pending";
  const profilePromoCode = data?.profile.promoCode ?? null;
  const isFoundingCoach = Boolean(data?.profile.foundingCoach);
  const foundingProTrialUsed = Boolean(data?.profile.foundingProTrialUsed);

  // When Stripe redirects back with a session id, synchronously verify the
  // session so we don't have to wait for the webhook race. Then keep
  // polling the profile query as a fallback in case sync propagation lags.
  const verifiedRef = useRef(false);
  useEffect(() => {
    if (checkoutStatus !== "return") return;
    if (returnedSessionId && !verifiedRef.current) {
      verifiedRef.current = true;
      verifyCheckoutFn({
        data: { sessionId: returnedSessionId, environment: getStripeEnvironment() },
      })
        .catch(() => {
          /* non-fatal — polling below will pick it up */
        })
        .finally(() => {
          qc.invalidateQueries({ queryKey: ["coach-profile"] });
        });
    }
    const iv = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["coach-profile"] });
    }, 2000);
    return () => window.clearInterval(iv);
  }, [checkoutStatus, returnedSessionId, qc, verifyCheckoutFn]);

  const isEntitled =
    entitlement === "paid" || entitlement === "promo_free" || entitlement === "club_covered";

  const currentTier = data?.profile.effectiveTier ?? null;
  // Explicit upgrade intent: coach clicked an "Upgrade" affordance elsewhere.
  const isUpgradeIntent = Boolean(preselectedTier);

  const onboardedAt = data?.profile.onboardedAt ?? null;

  useEffect(() => {
    if (!isEntitled) return;
    // Returning from a Stripe checkout always exits the paywall on
    // entitlement flip, regardless of any upgrade/manage intent that
    // may have been set on the pre-checkout URL.
    if (checkoutStatus === "return") {
      navigate({ to: onboardedAt ? "/coach/roster" : "/coach/onboarding", replace: true });
      return;
    }
    // Founding coaches stay to browse Coach Pro upgrade.
    if (isFoundingCoach) return;
    // Any coach who explicitly clicked "Upgrade" stays on the paywall.
    if (isUpgradeIntent) return;
    // Coach arrived from Settings → Change plan.
    if (manageIntent) return;
    // Otherwise: entitled coaches don't need the paywall.
    navigate({ to: onboardedAt ? "/coach/roster" : "/coach/onboarding", replace: true });
  }, [isEntitled, isFoundingCoach, isUpgradeIntent, manageIntent, checkoutStatus, onboardedAt, navigate]);

  // Auto-apply WELCOME_BACK when the coach was granted it on leaving a club.
  // Pre-fills the promo input, opens the section, and validates in the
  // background so Coach Pro shows the 3-months-free discount immediately.
  const welcomeBackAutoAppliedRef = useRef(false);
  useEffect(() => {
    if (welcomeBackAutoAppliedRef.current) return;

    if (isEntitled) return;
    if (profilePromoCode !== "WELCOME_BACK") return;
    if (promo.status !== "idle") return;
    welcomeBackAutoAppliedRef.current = true;
    setPromoInput("WELCOME_BACK");
    setPromoOpen(true);
    setPromo({ status: "validating" });
    validateCode({ data: { code: "WELCOME_BACK" } })
      .then((res) => {
        if (!res.valid || res.duration !== "repeating") {
          setPromo({ status: "idle" });
          return;
        }
        setPromo({
          status: "valid",
          code: "WELCOME_BACK",
          label: res.label ?? "WELCOME_BACK",
          duration: res.duration,
          durationInMonths: res.durationInMonths,
        });
      })
      .catch(() => setPromo({ status: "idle" }));
  }, [isEntitled, profilePromoCode, promo.status, welcomeBackAutoAppliedRef]);



  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  const subscriptionStatus = data?.profile.subscriptionStatus ?? null;
  const hasActiveSub =
    entitlement === "paid" &&
    !!data?.profile.hasStripeCustomer &&
    ["active", "trialing", "past_due"].includes(subscriptionStatus ?? "");

  const switchTier = useCallback(
    async (tier: Tier) => {
      setLoading(true);
      setSelectedTier(tier);
      try {
        const env = getStripeEnvironment();
        const result = await changeSubFn({
          data: {
            priceId: PRICE_MAP[tier][interval].priceId,
            environment: env,
          },
        });
        if ("error" in result) throw new Error(result.error);
        if (result.noop) {
          toast.message("You're already on that plan.");
        } else if ((result.refundedCents ?? 0) > 0) {
          toast.success(
            `Switched to ${tier === "coach_pro" ? "Coach Pro" : "Coach"}. Prorated refund issued to your card.`,
          );
        } else if ((result.chargedCents ?? 0) > 0) {
          toast.success(
            `Switched to ${tier === "coach_pro" ? "Coach Pro" : "Coach"}. Prorated difference charged today; renewal date unchanged.`,
          );
        } else {
          toast.success(
            `Switched to ${tier === "coach_pro" ? "Coach Pro" : "Coach"}.`,
          );
        }
        await qc.invalidateQueries({ queryKey: ["coach-profile"] });
        navigate({ to: "/coach/roster" });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't switch plans");
      } finally {
        setLoading(false);
        setSelectedTier(null);
      }
    },
    [changeSubFn, interval, qc, navigate],
  );

  const startCheckout = useCallback(
    async (tier: Tier) => {
      const promoCode = promo.status === "valid" ? promo.code : undefined;
      if (promoCode && tier !== "coach_pro") {
        toast.error("That promo code only applies to Coach Pro.");
        return;
      }
      setLoading(true);
      setSelectedTier(tier);
      try {
        const env = getStripeEnvironment();
        const returnUrl = `${window.location.origin}/coach/paywall?checkout=return&session_id={CHECKOUT_SESSION_ID}`;
        const result = await checkoutFn({
          data: {
            priceId: PRICE_MAP[tier][interval].priceId,
            environment: env,
            returnUrl,
            ...(promoCode && { promoCode }),
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
    [checkoutFn, interval, promo],
  );

  // Unified entry: if the coach already has a Stripe sub, swap it in place
  // (prorated). Otherwise open embedded checkout for a new sub.
  const handleTierAction = useCallback(
    (tier: Tier) => (hasActiveSub ? switchTier(tier) : startCheckout(tier)),
    [hasActiveSub, switchTier, startCheckout],
  );

  // Note: `?tier=coach_pro` only preselects visually. We intentionally do NOT
  // auto-trigger switchTier/startCheckout — that would silently change an
  // entitled coach's Stripe subscription on page load. The coach must click
  // the tier's action button to commit.



  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromo({ status: "validating" });
    try {
      const res = await validateCode({ data: { code } });
      if (!res.valid) {
        setPromo({ status: "invalid", message: "We don't recognize that code." });
        return;
      }
      if (res.duration !== "repeating") {
        setPromo({ status: "invalid", message: "That code isn't redeemable at checkout." });
        return;
      }
      setPromo({
        status: "valid",
        code,
        label: res.label ?? code,
        duration: res.duration,
        durationInMonths: res.durationInMonths,
      });
    } catch {
      setPromo({ status: "invalid", message: "Couldn't check that code." });
    }
  };

  const clearPromo = () => {
    setPromoInput("");
    setPromo({ status: "idle" });
  };

  const joinClub = async () => {
    if (!clubOrg || !clubCodeVerified) return;
    const code = clubCode.trim().toUpperCase();
    if (!code) return;
    setClaimingClub(true);
    try {
      await claimClub({ data: { code } });
      await qc.invalidateQueries({ queryKey: ["coach-profile"] });
      toast.success(`Joined ${clubOrg.name} — your subscription is covered.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That code isn't recognized.");
    } finally {
      setClaimingClub(false);
    }
  };

  const handleNotListed = async (typedQuery: string) => {
    try {
      await recordLead({
        data: {
          source: "not_listed",
          typedQuery: typedQuery || undefined,
        },
      });
    } catch {
      /* silent — lead capture must never block the coach */
    }
    toast.success(
      typedQuery
        ? `Thanks — we'll reach out to "${typedQuery}".`
        : "Thanks — we'll be in touch.",
    );
  };

  const resetClub = () => {
    setClubOrg(null);
    setClubCode("");
    setClubCodeVerified(false);
  };

  const options = useMemo(
    () => (clientSecret ? { fetchClientSecret: async () => clientSecret } : null),
    [clientSecret],
  );

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

  // Returning from Stripe checkout — show a processing state while we
  // verify the session and wait for entitlement to flip. The redirect
  // useEffect above navigates to /coach/roster the moment it flips.
  if (checkoutStatus === "return" && !isEntitled) {
    return (
      <div className="min-h-dvh">
        <PaymentTestModeBanner />
        <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
          <h1 className="font-display text-h2 text-text-primary">Finishing up…</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Confirming your subscription with Stripe. This usually takes a few seconds.
          </p>
        </div>
      </div>
    );
  }

  const proPromoMonths = promo.status === "valid" ? promo.durationInMonths ?? 0 : 0;
  // Founding coaches get a one-time 1-month Pro trial (no card, no promo needed).
  const foundingProTrialAvailable =
    isFoundingCoach && !foundingProTrialUsed && promo.status !== "valid";
  const proMonths = proPromoMonths > 0 ? proPromoMonths : foundingProTrialAvailable ? 1 : 0;
  const proCtaLabel =
    proMonths > 0
      ? `Start ${proMonths} month${proMonths === 1 ? "" : "s"} free`
      : "Continue";

  return (
    <div className="min-h-dvh">
      <PaymentTestModeBanner />
      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-5">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
          <Sparkles className="h-5 w-5" />
        </div>
        <h1 className="text-center font-display text-h2 text-text-primary">
          {isEntitled ? "Manage your plan" : "Activate your workspace"}
        </h1>
        <p className="mt-1.5 max-w-md text-center text-sm text-text-secondary">
          {isEntitled ? "Change tier or apply a promo." : "Pick a plan to get started. Cancel anytime."}
        </p>

        {isEntitled && (
          <div className="mt-4 w-full rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-center text-sm">
            <span className="text-text-secondary">Current plan: </span>
            <span className="font-semibold text-text-primary">
              {isFoundingCoach
                ? "Founding Coach — free for life"
                : currentTier === "club"
                  ? `Club${data?.profile.organizationName ? ` — ${data.profile.organizationName}` : ""}`
                  : currentTier === "coach_pro"
                    ? "Coach Pro"
                    : "Coach"}
            </span>
          </div>
        )}

        {/* 1. Club search + code — only for un-entitled coaches; existing paid coaches are linked backend-side */}
        {!isEntitled && (
        <div className="mt-5 w-full rounded-xl border border-divider bg-elevated p-3">
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-text-primary">Joining through a club?</p>
              <p className="mt-1 text-text-secondary">
                If your academy or association is a Gradus partner, they can cover your subscription.
              </p>
              <div className="mt-3 space-y-3">
                {!clubOrg && (
                  <OrgSearchCombobox
                    selected={null}
                    onSelect={(o) => {
                      setClubOrg(o);
                      setClubCode("");
                      setClubCodeVerified(false);
                    }}
                    onNotListed={(q) => void handleNotListed(q)}
                  />
                )}
                {clubOrg && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone="accent" size="small" caseSensitive>
                        <Building2 className="h-3.5 w-3.5" />
                        {clubOrg.name}
                      </Chip>
                      <button
                        type="button"
                        onClick={resetClub}
                        className="text-xs text-text-tertiary underline-offset-2 hover:text-text-secondary hover:underline"
                      >
                        Change
                      </button>
                    </div>
                    <OrgCodeField
                      orgId={clubOrg.id}
                      orgName={clubOrg.name}
                      value={clubCode}
                      onChange={(next, ok) => {
                        setClubCode(next);
                        setClubCodeVerified(ok);
                      }}
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        onClick={joinClub}
                        disabled={claimingClub || !clubCodeVerified}
                      >
                        {claimingClub ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          `Join ${clubOrg.name}`
                        )}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        )}



        {/* 2. Promo code CTA */}
        <div className="mt-4 w-full">
          {!promoOpen && promo.status !== "valid" ? (
            <button
              type="button"
              onClick={() => setPromoOpen(true)}
              className="press flex w-full items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/20 text-accent-ink">
                  <Tag className="h-4 w-4" />
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-text-primary">Have a promo code?</span>
                  <span className="text-xs text-text-secondary">Unlock free months of Coach Pro</span>
                </span>
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
                Apply
              </span>
            </button>
          ) : (
            <div className="rounded-xl border border-divider bg-elevated p-3">
              {promo.status === "valid" ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm">
                    <p className="font-semibold text-text-primary">
                      <span className="font-mono uppercase tracking-widest">{promo.code}</span> applied
                    </p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {promo.label} — applies to Coach Pro. Card required, charges resume after free months.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearPromo}
                    className="text-xs text-text-secondary underline underline-offset-2"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <div className="flex-1">
                    <Input
                      value={promoInput}
                      onChange={(e) => setPromoInput(e.target.value.toUpperCase().slice(0, 32))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void applyPromo();
                        }
                      }}
                      placeholder="Promo code"
                      className="font-mono uppercase tracking-widest"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {promo.status === "invalid" && (
                      <p className="mt-1 text-xs text-destructive">{promo.message}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setPromoOpen(false);
                        setPromoInput("");
                        setPromo({ status: "idle" });
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={applyPromo}
                      disabled={promo.status === "validating" || !promoInput.trim()}
                    >
                      {promo.status === "validating" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Apply"
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. Interval toggle */}
        <div
          className={cn(
            "mt-5 inline-flex rounded-full border border-divider bg-elevated p-1 text-sm transition-opacity",
            tiersDisabled && "pointer-events-none opacity-50",
          )}
          aria-disabled={tiersDisabled}
        >
          {(["month", "year"] as const).map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              className={cn(
                "rounded-full px-4 py-1.5 press-soft",
                interval === iv ? "bg-popover text-text-primary shadow-sm" : "text-text-secondary",
              )}
            >
              {iv === "month" ? "Monthly" : "Yearly"}
              {iv === "year" && <span className="ml-1 text-xs text-accent-ink">save 15%</span>}
            </button>
          ))}
        </div>

        {tiersDisabled && (
          <p className="mt-2 text-center text-xs text-text-tertiary">
            Individual plans unavailable while a club code is entered.
          </p>
        )}

        {/* 4. Tier cards */}
        <div
          className={cn(
            "mt-4 grid w-full grid-cols-2 gap-3 transition-opacity",
            tiersDisabled && "pointer-events-none opacity-50",
          )}
          aria-disabled={tiersDisabled}
        >
          {(Object.keys(PRICE_MAP) as Tier[]).map((tier) => {
            const price = PRICE_MAP[tier][interval];
            const isPro = tier === "coach_pro";
            // Only mark Coach as "Active" for founding coaches who have
            // already claimed entitlement. A brand-new founding coach
            // (entitlement === "pending") needs the CTA to activate.
            const coachFoundingActive = tier === "coach" && isFoundingCoach && isEntitled;
            const coachFoundingClaim = tier === "coach" && isFoundingCoach && !isEntitled;
            const isCurrentTier = isEntitled && !isFoundingCoach && currentTier === tier;
            const promoAppliesHere = isPro && promo.status === "valid";
            const foundingTrialHere = isPro && foundingProTrialAvailable && !promoAppliesHere;

            return (
              <div
                key={tier}
                className={cn(
                  "flex flex-col rounded-2xl border p-3 shadow-card sm:p-4",
                  isCurrentTier
                    ? "border-accent bg-accent/5"
                    : isPro
                      ? "border-accent/60 bg-card"
                      : "border-divider bg-card",
                )}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <h2 className="font-display text-lg text-text-primary sm:text-h3">
                    {isPro ? "Coach Pro" : "Coach"}
                  </h2>
                  {(coachFoundingActive || coachFoundingClaim) ? (
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-ink sm:text-[10px] sm:tracking-widest">
                      FOUNDING
                    </span>
                  ) : isCurrentTier ? (
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-ink sm:text-[10px] sm:tracking-widest">
                      CURRENT
                    </span>
                  ) : null}
                </div>

                {(coachFoundingActive || coachFoundingClaim) ? (
                  <>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="font-display text-2xl text-text-primary sm:text-4xl">Free</span>
                    </div>
                    <p className="mt-1 text-[11px] text-text-tertiary sm:text-xs">
                      Yours for being here early.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="font-display text-2xl text-text-primary tabular-nums sm:text-4xl">
                        ${price.monthlyEquivalent}
                      </span>
                      <span className="text-xs text-text-secondary sm:text-sm">/ mo</span>
                    </div>
                    <p className="mt-1 text-[11px] text-text-tertiary sm:text-xs">{price.billed}</p>
                  </>
                )}

                {promoAppliesHere && proPromoMonths > 0 && (
                  <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-ink sm:text-[11px]">
                    <Tag className="h-3 w-3" /> {proPromoMonths} months free · then ${price.monthlyEquivalent}/mo
                  </p>
                )}
                {foundingTrialHere && (
                  <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-ink sm:text-[11px]">
                    <Sparkles className="h-3 w-3" /> Founding · 1 month free · no card today
                  </p>
                )}

                <ul className="mt-3 space-y-1.5 text-xs text-text-secondary sm:text-sm">
                  {FEATURES[tier].map((f) => (
                    <li key={f} className="flex items-start gap-1.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-ink sm:h-4 sm:w-4" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {coachFoundingActive ? (
                  <div className="mt-4 inline-flex items-center justify-center gap-1 rounded-md border border-divider bg-elevated px-3 py-2 text-xs font-semibold text-text-primary sm:text-sm">
                    <Check className="h-4 w-4 text-accent-ink" /> Active
                  </div>
                ) : isCurrentTier ? (
                  <div className="mt-4 inline-flex items-center justify-center gap-1 rounded-md border border-divider bg-elevated px-3 py-2 text-xs font-semibold text-text-primary sm:text-sm">
                    <Check className="h-4 w-4 text-accent-ink" /> Current plan
                  </div>
                ) : coachFoundingClaim ? (
                  <Button
                    type="button"
                    className="mt-4 w-full text-xs sm:text-sm"
                    disabled={loading || tiersDisabled}
                    onClick={async () => {
                      setLoading(true);
                      setSelectedTier(tier);
                      try {
                        const res = await claimFoundingFn();
                        if ("error" in res) throw new Error(res.error);
                        await qc.invalidateQueries({ queryKey: ["coach-profile"] });
                        navigate({
                          to: onboardedAt ? "/coach/roster" : "/coach/onboarding",
                          replace: true,
                        });
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Couldn't activate Coach tier");
                      } finally {
                        setLoading(false);
                        setSelectedTier(null);
                      }
                    }}
                  >
                    {loading && selectedTier === tier ? "Activating…" : "Continue"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="mt-4 w-full text-xs sm:text-sm"
                    disabled={loading || tiersDisabled}
                    onClick={() => handleTierAction(tier)}
                  >
                    {loading && selectedTier === tier
                      ? "Starting…"
                      : isPro
                        ? proCtaLabel
                        : "Continue"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {isEntitled && (
          <div className="mt-5 w-full text-center">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() =>
                navigate({
                  to: onboardedAt ? "/coach/roster" : "/coach/onboarding",
                  replace: true,
                })
              }
            >
              No changes - return to my workspace
            </Button>
          </div>
        )}

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
