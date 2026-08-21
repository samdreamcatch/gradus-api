import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { ArrowLeft, Check, CreditCard, Eye, KeyRound, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import {
  getTeamPlanStatus,
  startTeamCheckout,
  createParentBillingPortalSession,
} from "@/lib/parent-checkout.functions";
import { claimGuardianInvite } from "@/lib/team-guardians.functions";
import { listCoachVisibility, setCoachVisibility } from "@/lib/coach-visibility.functions";

type Interval = "month" | "year";

const PRICE_MAP: Record<
  Interval,
  { priceId: "team_monthly" | "team_yearly"; monthlyEquivalent: number; billed: string }
> = {
  month: { priceId: "team_monthly", monthlyEquivalent: 15, billed: "$15/mo, billed monthly" },
  year: { priceId: "team_yearly", monthlyEquivalent: 13.5, billed: "$162/yr — save 10%" },
};

const FREE_FEATURES = [
  "One parent account",
  "Plans, goals, and practice log",
  "Message your athlete's coach",
  "Unlimited athletes",
];

const TEAM_FEATURES = [
  "Shared plans and goals",
  "Team-wide notifications",
  "Up to three guardians",
  "Connect your athlete's coaches",
];


export const Route = createFileRoute("/_authenticated/parent/team")({
  head: () => ({
    meta: [
      { title: "Team plan — Gradus" },
      {
        name: "description",
        content:
          "Add another parent or guardian to your athlete and manage your Gradus Team plan.",
      },
      { property: "og:title", content: "Team plan — Gradus" },
      {
        property: "og:description",
        content:
          "Add another parent or guardian to your athlete and manage your Gradus Team plan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ParentTeamPage,
});

function ParentTeamPage() {
  const fetchStatus = useServerFn(getTeamPlanStatus);
  const startCheckout = useServerFn(startTeamCheckout);
  const openPortal = useServerFn(createParentBillingPortalSession);

  const status = useQuery({ queryKey: ["team-plan-status"], queryFn: () => fetchStatus() });

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [interval, setInterval] = useState<Interval>("month");
  const [busy, setBusy] = useState<string | null>(null);

  const options = useMemo(
    () => (clientSecret ? { fetchClientSecret: async () => clientSecret } : null),
    [clientSecret],
  );

  const handleUpgrade = async (priceId: "team_monthly" | "team_yearly") => {
    setBusy(priceId);
    try {
      const result = await startCheckout({
        data: {
          priceId,
          environment: getStripeEnvironment(),
          returnUrl: `${window.location.origin}/parent/settings?checkout=return`,
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
          returnUrl: `${window.location.origin}/parent/team`,
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
        <Link
          to="/parent/settings"
          className="press mb-3 self-start inline-flex items-center gap-1 text-sm text-text-secondary"
        >
          <ArrowLeft className="h-4 w-4" /> {planActive ? "Back to settings" : "Not now"}
        </Link>

        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
          <Users className="h-5 w-5" />
        </div>
        <h1 className="text-center font-display text-h2 text-text-primary">
          {planActive ? "Manage your plan" : "Add a parent or guardian"}
        </h1>
        <p className="mt-1.5 max-w-md text-center text-sm text-text-secondary">
          {planActive
            ? "Invite guardians, or change your billing."
            : "Add up to three guardians per athlete on Team plan"}
        </p>

        {planActive && (
          <div className="mt-4 w-full rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-center text-sm">
            <span className="text-text-secondary">Current plan: </span>
            <span className="font-semibold text-text-primary">
              Team{status.data?.status ? ` — ${status.data.status}` : ""}
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
              <h2 className="font-display text-lg text-text-primary sm:text-h3">One parent or guardian</h2>
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

          {/* Team */}
          <div
            className={cn(
              "flex flex-col rounded-2xl border p-3 shadow-card sm:p-4",
              planActive ? "border-accent bg-accent/5" : "border-accent/60 bg-card",
            )}
          >
            <div className="flex items-baseline justify-between gap-1">
              <h2 className="font-display text-lg text-text-primary sm:text-h3">Team</h2>
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
              {TEAM_FEATURES.map((f) => (
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

        <CoachVisibilitySection planActive={planActive} />

        {/* Join by code */}
        <div className="mt-7 flex w-full items-center gap-3">

          <div className="h-px flex-1 bg-divider" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
            Or join a team
          </span>
          <div className="h-px flex-1 bg-divider" />
        </div>

        <JoinByCodeSection />
      </div>
      <ParentBottomNav />
    </>
  );
}

/**
 * Per-coach sharing toggles. Turning a coach on asks that coach — and every
 * other coach already on for this athlete — to accept a two-way window.
 */
function CoachVisibilitySection({ planActive }: { planActive: boolean }) {
  const qc = useQueryClient();
  const fetchVisibility = useServerFn(listCoachVisibility);
  const setVisibility = useServerFn(setCoachVisibility);
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["coach-visibility"],
    queryFn: () => fetchVisibility(),
    enabled: planActive,
  });

  if (!planActive) {
    return (
      <div className="mt-5 w-full rounded-xl border border-divider bg-elevated p-3">
        <div className="flex items-start gap-3">
          <Eye className="mt-0.5 h-5 w-5 shrink-0 text-text-tertiary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary">Connect your athlete's coaches</p>
            <p className="mt-0.5 text-[11px] text-text-tertiary sm:text-xs">
              On the Team plan you can let an athlete's coaches see each other's plans, practice log,
              goals, and schedule — read only, and only when both coaches agree.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const athletes = (q.data?.athletes ?? []).filter((a) => a.coaches.length > 0);

  return (
    <div className="mt-7 w-full">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-divider" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          Coach visibility
        </span>
        <div className="h-px flex-1 bg-divider" />
      </div>

      <p className="mt-3 text-center text-[11px] text-text-tertiary sm:text-xs">
        Turn a coach on to let them see — and be seen by — this athlete's other connected coaches.
        Both coaches have to accept.
      </p>

      {q.isPending ? (
        <div className="mt-4 flex justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
        </div>
      ) : athletes.length === 0 ? (
        <p className="mt-4 text-center text-xs text-text-tertiary">
          No coaches connected to your athletes yet.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {athletes.map((a) => (
            <div key={a.id} className="rounded-xl border border-divider bg-card p-3 shadow-card">
              <p className="text-sm font-semibold text-text-primary">
                {a.firstName} {a.lastName}
              </p>
              <div className="mt-2 flex flex-col divide-y divide-divider">
                {a.coaches.map((c) => (
                  <div key={c.coachId} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-text-primary">{c.name}</p>
                      <p className="text-[11px] text-text-tertiary">
                        {c.status === "connected"
                          ? "Connected"
                          : c.status === "pending"
                            ? "Waiting on coaches to accept"
                            : c.status === "declined"
                              ? "Declined"
                              : c.status === "waiting"
                                ? "On — add another coach to connect"
                                : "Off"}
                      </p>
                    </div>
                    <Switch
                      checked={c.enabled}
                      disabled={busy === `${a.id}:${c.coachId}`}
                      onCheckedChange={async (next) => {
                        setBusy(`${a.id}:${c.coachId}`);
                        try {
                          await setVisibility({
                            data: { athleteId: a.id, coachId: c.coachId, enabled: next },
                          });
                          await qc.invalidateQueries({ queryKey: ["coach-visibility"] });
                          toast.success(next ? "Request sent to your coaches." : "Sharing turned off.");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Couldn't update sharing.");
                        } finally {
                          setBusy(null);
                        }
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


/** Accept an invite you were given as a code (rather than a link). */
function JoinByCodeSection() {
  const qc = useQueryClient();
  const navigate = useNavigate();
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
                  void navigate({ to: "/parent/settings" });
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
