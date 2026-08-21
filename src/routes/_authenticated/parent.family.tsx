import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import {
  ArrowLeft,
  Check,
  CreditCard,
  KeyRound,
  Loader2,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import {
  getFamilyPlanStatus,
  startFamilyCheckout,
  createParentBillingPortalSession,
} from "@/lib/parent-checkout.functions";
import {
  listFamilyGuardians,
  inviteGuardian,
  revokeGuardianInvite,
  removeGuardian,
  claimGuardianInvite,
} from "@/lib/family-guardians.functions";

type Interval = "month" | "year";

const PRICE_MAP: Record<
  Interval,
  { priceId: "family_monthly" | "family_yearly"; monthlyEquivalent: number; billed: string }
> = {
  month: { priceId: "family_monthly", monthlyEquivalent: 15, billed: "$15/mo, billed monthly" },
  year: { priceId: "family_yearly", monthlyEquivalent: 13.5, billed: "$162/yr — save 10%" },
};

const FREE_FEATURES = [
  "One parent account",
  "Plans, goals, and practice log",
  "Message your athlete's coach",
  "Unlimited athletes",
];

const FAMILY_FEATURES = [
  "Everything in Single parent",
  "Full access for co-guardians",
  "Shared plans and goals",
  "Shared coach messaging",
  "Unlimited guardians per athlete",
];

export const Route = createFileRoute("/_authenticated/parent/family")({
  head: () => ({
    meta: [
      { title: "Family plan — Gradus" },
      {
        name: "description",
        content:
          "Add another parent or guardian to your athlete and manage your Gradus Family plan.",
      },
      { property: "og:title", content: "Family plan — Gradus" },
      {
        property: "og:description",
        content:
          "Add another parent or guardian to your athlete and manage your Gradus Family plan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { checkout?: string } => ({
    checkout: typeof search["checkout"] === "string" ? (search["checkout"] as string) : undefined,
  }),
  component: ParentFamilyPage,
});

function ParentFamilyPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { checkout } = Route.useSearch();

  const fetchStatus = useServerFn(getFamilyPlanStatus);
  const fetchGuardians = useServerFn(listFamilyGuardians);
  const startCheckout = useServerFn(startFamilyCheckout);
  const openPortal = useServerFn(createParentBillingPortalSession);

  const status = useQuery({ queryKey: ["family-plan-status"], queryFn: () => fetchStatus() });
  const guardians = useQuery({ queryKey: ["family-guardians"], queryFn: () => fetchGuardians() });

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [interval, setInterval] = useState<Interval>("month");
  const [busy, setBusy] = useState<string | null>(null);

  // Returning from Stripe — refresh status so the page flips to "active".
  useEffect(() => {
    if (checkout !== "return") return;
    void qc.invalidateQueries({ queryKey: ["family-plan-status"] });
    void qc.invalidateQueries({ queryKey: ["family-guardians"] });
    toast.success("Thanks! Your Family plan is being activated.");
    void navigate({ to: "/parent/family", search: () => ({}), replace: true });
  }, [checkout, qc, navigate]);

  const options = useMemo(
    () => (clientSecret ? { fetchClientSecret: async () => clientSecret } : null),
    [clientSecret],
  );

  const handleUpgrade = async (priceId: "family_monthly" | "family_yearly") => {
    setBusy(priceId);
    try {
      const result = await startCheckout({
        data: {
          priceId,
          environment: getStripeEnvironment(),
          returnUrl: `${window.location.origin}/parent/family?checkout=return`,
        },
      });
      if ("error" in result) throw new Error(result.error);
      setClientSecret(result.clientSecret);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start checkout.");
    } finally {
      setBusy(null);
    }
  };

  const handlePortal = async () => {
    setBusy("portal");
    try {
      const result = await openPortal({
        data: {
          environment: getStripeEnvironment(),
          returnUrl: `${window.location.origin}/parent/family`,
        },
      });
      if ("error" in result) throw new Error(result.error);
      window.open(result.url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open billing.");
    } finally {
      setBusy(null);
    }
  };

  // Embedded checkout takes over the page.
  if (clientSecret && options) {
    return (
      <div className="min-h-dvh">
        <PaymentTestModeBanner />
        <div className="mx-auto max-w-2xl px-4 py-6">
          <button
            type="button"
            onClick={() => setClientSecret(null)}
            className="press mb-4 inline-flex items-center gap-1 text-sm text-text-secondary"
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

  if (checkout === "return") {
    return (
      <div className="min-h-dvh">
        <PaymentTestModeBanner />
        <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
          <h1 className="font-display text-h2 text-text-primary">Finishing up…</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Confirming your Family plan. This usually takes a few seconds.
          </p>
        </div>
      </div>
    );
  }

  if (status.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4 py-12">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
          <p className="font-display text-h3 text-text-primary">Loading your plan…</p>
        </div>
      </div>
    );
  }

  const planActive = status.data?.active ?? false;
  const price = PRICE_MAP[interval];

  return (
    <>
      <PaymentTestModeBanner />
      <div className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center px-4 pt-5 pb-28">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
          <Users className="h-5 w-5" />
        </div>
        <h1 className="text-center font-display text-h2 text-text-primary">
          {planActive ? "Manage your plan" : "Add a parent or guardian"}
        </h1>
        <p className="mt-1.5 max-w-md text-center text-sm text-text-secondary">
          {planActive
            ? "Invite guardians, or change your billing."
            : "Give another parent or guardian full access to your athlete. Cancel anytime."}
        </p>

        {planActive && (
          <div className="mt-4 w-full rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-center text-sm">
            <span className="text-text-secondary">Current plan: </span>
            <span className="font-semibold text-text-primary">
              Family{status.data?.status ? ` — ${status.data.status}` : ""}
            </span>
          </div>
        )}

        {/* Plan cards */}
        <div className="mt-5 flex w-full flex-col gap-3">
          {/* Single parent */}
          <div
            className={cn(
              "flex flex-col rounded-2xl border p-3 shadow-card sm:p-4",
              planActive ? "border-divider bg-card" : "border-accent bg-accent/5",
            )}
          >
            <div className="flex items-baseline justify-between gap-1">
              <h2 className="font-display text-lg text-text-primary sm:text-h3">Single parent</h2>
              {!planActive && (
                <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-ink sm:text-[10px] sm:tracking-widest">
                  CURRENT
                </span>
              )}
            </div>

            <div className="mt-2">
              <div className="flex items-baseline gap-1">
                <span className="font-display text-2xl text-text-primary sm:text-4xl">Free</span>
              </div>
              <p className="mt-0.5 text-[11px] text-text-tertiary sm:text-xs">
                Included with every parent account.
              </p>
            </div>

            <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-text-secondary sm:text-xs">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-1.5">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-accent-ink sm:h-3.5 sm:w-3.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {!planActive && (
              <div className="mt-4 inline-flex items-center justify-center gap-1 rounded-md border border-divider bg-elevated px-3 py-2 text-xs font-semibold text-text-primary sm:text-sm">
                <Check className="h-4 w-4 text-accent-ink" /> Current plan
              </div>
            )}
          </div>

          {/* Family */}
          <div
            className={cn(
              "flex flex-col rounded-2xl border p-3 shadow-card sm:p-4",
              planActive ? "border-accent bg-accent/5" : "border-accent/60 bg-card",
            )}
          >
            <div className="flex items-baseline justify-between gap-1">
              <h2 className="font-display text-lg text-text-primary sm:text-h3">Family</h2>
              <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-ink sm:text-[10px] sm:tracking-widest">
                {planActive ? "CURRENT" : "RECOMMENDED"}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="font-display text-2xl text-text-primary tabular-nums sm:text-4xl">
                    ${price.monthlyEquivalent}
                  </span>
                  <span className="text-xs text-text-secondary sm:text-sm">/ mo</span>
                </div>
                <p className="mt-0.5 text-[11px] text-text-tertiary sm:text-xs">{price.billed}</p>
              </div>

              {!planActive && (
                <div className="inline-flex shrink-0 rounded-full border border-divider bg-elevated p-0.5 text-xs">
                  {(["month", "year"] as const).map((iv) => (
                    <button
                      key={iv}
                      type="button"
                      onClick={() => setInterval(iv)}
                      className={cn(
                        "press-soft whitespace-nowrap rounded-full px-2.5 py-1",
                        interval === iv
                          ? "bg-popover text-text-primary shadow-sm"
                          : "text-text-secondary",
                      )}
                    >
                      {iv === "month" ? "Monthly" : "Yearly"}
                      {iv === "year" && (
                        <span className="ml-1 text-[10px] text-accent-ink">−10%</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-text-secondary sm:text-xs">
              {FAMILY_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-1.5">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-accent-ink sm:h-3.5 sm:w-3.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {planActive ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-4 w-full text-xs sm:text-sm"
                disabled={busy === "portal"}
                onClick={() => void handlePortal()}
              >
                <CreditCard className="h-4 w-4" />
                <span className="ml-1">
                  {busy === "portal" ? "Opening…" : "Manage billing"}
                </span>
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  className="mt-4 w-full text-xs sm:text-sm"
                  disabled={busy === price.priceId}
                  onClick={() => void handleUpgrade(price.priceId)}
                >
                  {busy === price.priceId ? "Starting…" : "Continue"}
                </Button>
                <p className="mt-2 text-center text-[11px] text-text-tertiary">Cancel anytime</p>
              </>
            )}
          </div>
        </div>

        {/* Guardians */}
        <div className="mt-7 flex w-full items-center gap-3">
          <div className="h-px flex-1 bg-divider" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
            Guardians
          </span>
          <div className="h-px flex-1 bg-divider" />
        </div>

        <div className="mt-5 w-full space-y-3">
          {guardians.isLoading ? (
            <p className="text-center text-sm text-text-tertiary">Loading…</p>
          ) : !guardians.data?.athletes.length ? (
            <p className="text-center text-sm text-text-tertiary">Add an athlete first.</p>
          ) : (
            guardians.data.athletes.map((a) => (
              <AthleteGuardians
                key={a.id}
                athlete={a}
                planActive={planActive}
                onUpgrade={() => void handleUpgrade(price.priceId)}
              />
            ))
          )}
        </div>

        {/* Join by code */}
        <div className="mt-7 flex w-full items-center gap-3">
          <div className="h-px flex-1 bg-divider" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
            Or join a family
          </span>
          <div className="h-px flex-1 bg-divider" />
        </div>

        <JoinByCodeSection />
      </div>
      <ParentBottomNav />
    </>
  );
}

type AthleteRow = Awaited<ReturnType<typeof listFamilyGuardians>>["athletes"][number];

function AthleteGuardians({
  athlete,
  planActive,
  onUpgrade,
}: {
  athlete: AthleteRow;
  planActive: boolean;
  onUpgrade: () => void;
}) {
  const qc = useQueryClient();
  const invite = useServerFn(inviteGuardian);
  const revoke = useServerFn(revokeGuardianInvite);
  const remove = useServerFn(removeGuardian);

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["family-guardians"] });

  const handleInvite = async () => {
    setBusy(true);
    try {
      const res = await invite({
        data: { athleteId: athlete.id, email: email.trim() ? email.trim() : null },
      });
      toast.success(email.trim() ? `Invite sent — code ${res.code}` : `Invite code ${res.code}`);
      setEmail("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create that invite.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-divider bg-card p-3 shadow-card sm:p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-lg text-text-primary sm:text-h3">
          {`${athlete.firstName} ${athlete.lastName}`.trim()}
        </h3>
        <span className="text-[11px] text-text-tertiary sm:text-xs">
          {athlete.guardians.length} guardian{athlete.guardians.length === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="mt-3 space-y-2">
        {athlete.guardians.map((g) => (
          <li key={g.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-text-primary">
              {g.name} {g.isSelf && <span className="text-text-tertiary">(you)</span>}
            </span>
            <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-ink sm:text-[10px] sm:tracking-widest">
              {g.role === "primary" ? "PRIMARY" : "GUARDIAN"}
            </span>
            {g.role === "co" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Remove ${g.name}`}
                onClick={async () => {
                  try {
                    await remove({ data: { athleteId: athlete.id, parentId: g.parentId } });
                    toast.success("Guardian removed");
                    refresh();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Couldn't remove them.");
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {athlete.invites.length > 0 && (
        <ul className="mt-2 space-y-2 border-t border-divider pt-2">
          {athlete.invites.map((i) => (
            <li key={i.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-text-secondary">
                Pending · {i.email ?? "code only"}
              </span>
              <span className="font-mono text-xs text-text-primary">{i.code}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Revoke invite"
                onClick={async () => {
                  try {
                    await revoke({ data: { inviteId: i.id } });
                    toast.success("Invite revoked");
                    refresh();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Couldn't revoke that invite.");
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {planActive ? (
        <div className="mt-3 flex items-center gap-2">
          <Input
            type="email"
            inputMode="email"
            placeholder="Their email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="button" onClick={() => void handleInvite()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            <span className="ml-1">Invite</span>
          </Button>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-accent/40 bg-accent/10 p-3">
          <p className="text-[11px] text-text-secondary sm:text-xs">
            Adding another parent or guardian is part of the Family plan.
          </p>
          <Button type="button" className="mt-2 w-full text-xs sm:text-sm" onClick={onUpgrade}>
            Upgrade to invite
          </Button>
        </div>
      )}
    </div>
  );
}

/** Accept an invite you were given as a code (rather than a link). */
function JoinByCodeSection() {
  const qc = useQueryClient();
  const claim = useServerFn(claimGuardianInvite);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-5 w-full rounded-xl border border-divider bg-elevated p-3">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">Have an invite code?</p>
          <p className="mt-0.5 text-[11px] text-text-tertiary sm:text-xs">
            Enter the code another parent shared to join their athlete.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Input
              placeholder="Invite code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="font-mono"
            />
            <Button
              type="button"
              disabled={busy || code.trim().length < 4}
              onClick={async () => {
                setBusy(true);
                try {
                  await claim({ data: { code: code.trim() } });
                  toast.success("You've been added as a guardian.");
                  setCode("");
                  void qc.invalidateQueries();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Couldn't accept that invite.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Join"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
