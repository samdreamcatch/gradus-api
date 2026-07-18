import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Sparkles, Building2, Check, Tag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

/**
 * Dev-only visual preview of /coach/paywall.
 * - No auth, no entitlement redirects, no Stripe checkout, no server fns.
 * - Lets you toggle founding-coach state and simulate an applied promo code.
 * - Blocked outside dev (`import.meta.env.DEV`) so it never ships to prod.
 */

type Tier = "coach" | "coach_pro";
type Interval = "month" | "year";

const PRICE_MAP: Record<
  Tier,
  Record<Interval, { monthlyEquivalent: number; billed: string }>
> = {
  coach: {
    month: { monthlyEquivalent: 30, billed: "$30/mo, billed monthly" },
    year: { monthlyEquivalent: 25.5, billed: "$306/yr — save 15%" },
  },
  coach_pro: {
    month: { monthlyEquivalent: 70, billed: "$70/mo, billed monthly" },
    year: { monthlyEquivalent: 59.5, billed: "$714/yr — save 15%" },
  },
};

const FEATURES: Record<Tier, string[]> = {
  coach: [
    "Full coaching workspace",
    "Roster, plans, and messaging",
    "Athlete & parent portals",
    "Up to 5 athletes",
  ],
  coach_pro: [
    "Everything in Coach",
    "Multi-sport",
    "Advanced scheduling",
    "Up to 50 athletes",
    "Priority support",
  ],
};

export const Route = createFileRoute("/dev/paywall-preview")({
  component: PaywallPreview,
});

function PaywallPreview() {
  const [interval, setInterval] = useState<Interval>("year");
  const [isFoundingCoach, setIsFoundingCoach] = useState(false);
  const [hasOrg, setHasOrg] = useState(false);

  const [promoOpen, setPromoOpen] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promoApplied, setPromoApplied] = useState<{
    code: string;
    months: number;
  } | null>(null);
  const [validating, setValidating] = useState(false);

  const [clubOpen, setClubOpen] = useState(false);
  const [clubInput, setClubInput] = useState("");
  const tiersDisabled = clubInput.trim().length > 0;

  const applyPromo = () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setValidating(true);
    window.setTimeout(() => {
      setPromoApplied({ code, months: 3 });
      setValidating(false);
    }, 300);
  };

  const proMonths = promoApplied?.months ?? 0;
  const proCtaLabel =
    proMonths > 0
      ? `Start ${proMonths} month${proMonths === 1 ? "" : "s"} free`
      : "Subscribe";

  const controls = useMemo(
    () => (
      <div className="mx-auto mb-4 flex max-w-2xl flex-wrap items-center gap-2 rounded-xl border border-dashed border-divider bg-elevated px-3 py-2 text-xs text-text-secondary">
        <span className="font-semibold text-text-primary">Preview controls:</span>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={isFoundingCoach}
            onChange={(e) => setIsFoundingCoach(e.target.checked)}
          />
          Founding coach
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={hasOrg}
            onChange={(e) => setHasOrg(e.target.checked)}
          />
          Linked to org
        </label>
        <span className="ml-auto opacity-60">Visual preview only — no checkout</span>
      </div>
    ),
    [isFoundingCoach, hasOrg],
  );

  return (
    <div className="min-h-dvh">
      <PaymentTestModeBanner />
      <div className="px-4 pt-4">{controls}</div>
      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-5">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
          <Sparkles className="h-5 w-5" />
        </div>
        <h1 className="text-center font-display text-h2 text-text-primary">
          Activate your workspace
        </h1>
        <p className="mt-1.5 max-w-md text-center text-sm text-text-secondary">
          Pick a plan to get started. Cancel anytime.
        </p>

        <div className="mt-5 w-full rounded-xl border border-divider bg-elevated p-3">
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-text-primary">
                Joining through a club?
              </p>
              <p className="mt-1 text-text-secondary">
                If your academy or association is a Gradus partner, they can cover
                your subscription.
              </p>
              {!clubOpen ? (
                <button
                  type="button"
                  onClick={() => setClubOpen(true)}
                  className="mt-2 inline-block text-accent-ink underline underline-offset-2"
                >
                  Enter club code →
                </button>
              ) : (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
                  <Input
                    value={clubInput}
                    onChange={(e) =>
                      setClubInput(e.target.value.toUpperCase().slice(0, 32))
                    }
                    placeholder="Club code"
                    className="font-mono uppercase tracking-widest sm:flex-1"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setClubOpen(false);
                        setClubInput("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!clubInput.trim()}
                    >
                      Join
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 w-full">
          {!promoOpen && !promoApplied ? (
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
                  <span className="text-sm font-semibold text-text-primary">
                    Have a promo code?
                  </span>
                  <span className="text-xs text-text-secondary">
                    Unlock free months of Coach Pro
                  </span>
                </span>
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
                Apply
              </span>
            </button>
          ) : (
            <div className="rounded-xl border border-divider bg-elevated p-3">
              {promoApplied ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm">
                    <p className="font-semibold text-text-primary">
                      <span className="font-mono uppercase tracking-widest">
                        {promoApplied.code}
                      </span>{" "}
                      applied
                    </p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      3 months free — applies to Coach Pro. Card required, charges
                      resume after free months.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPromoApplied(null);
                      setPromoInput("");
                    }}
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
                      onChange={(e) =>
                        setPromoInput(e.target.value.toUpperCase().slice(0, 32))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyPromo();
                        }
                      }}
                      placeholder="Promo code"
                      className="font-mono uppercase tracking-widest"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setPromoOpen(false);
                        setPromoInput("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={applyPromo}
                      disabled={validating || !promoInput.trim()}
                    >
                      {validating ? (
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

        {tiersDisabled && (
          <p className="mt-2 text-center text-xs text-text-tertiary">
            Individual plans unavailable while a club code is entered.
          </p>
        )}

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
            const coachFoundingActive = tier === "coach" && isFoundingCoach;
            const promoAppliesHere = isPro && promoApplied != null;



            return (
              <div
                key={tier}
                className={cn(
                  "flex flex-col rounded-2xl border p-3 shadow-card sm:p-4",
                  isPro ? "border-accent/60 bg-card" : "border-divider bg-card",
                )}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <h2 className="font-display text-lg text-text-primary sm:text-h3">
                    {isPro ? "Coach Pro" : "Coach"}
                  </h2>
                  {coachFoundingActive && (
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-ink sm:text-[10px] sm:tracking-widest">
                      FOUNDING
                    </span>
                  )}
                </div>

                {coachFoundingActive ? (
                  <>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="font-display text-2xl text-text-primary sm:text-4xl">
                        Free
                      </span>
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
                      <span className="text-xs text-text-secondary sm:text-sm">
                        / mo
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-text-tertiary sm:text-xs">
                      {price.billed}
                    </p>
                  </>
                )}

                {promoAppliesHere && proMonths > 0 && (
                  <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-ink sm:text-[11px]">
                    <Tag className="h-3 w-3" /> {proMonths} months free · then $
                    {price.monthlyEquivalent}/mo
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
                ) : (
                  <Button
                    type="button"
                    className="mt-4 w-full text-xs sm:text-sm"
                    onClick={() => {
                      /* no-op in preview */
                    }}
                  >
                    {isPro ? proCtaLabel : "Subscribe"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>


        {hasOrg && (
          <div className="mt-4 text-center">
            <button
              type="button"
              className="text-xs text-text-tertiary underline underline-offset-2"
            >
              Unlink from current club
            </button>
          </div>
        )}

        <div className="mt-5 border-t border-divider pt-3 text-center">
          <button
            type="button"
            className="text-xs text-text-tertiary underline underline-offset-2"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
