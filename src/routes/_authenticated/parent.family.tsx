import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { ArrowLeft, CreditCard, KeyRound, Loader2, Mail, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { PageTitle } from "@/components/page-title";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { PaymentTestModeBanner } from "@/components/payment-test-mode-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SettingsGroup,
  SettingsList,
  SettingsRow,
  SettingsButtonRow,
  SettingsDisclosure,
} from "@/components/settings/primitives";
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

export const Route = createFileRoute("/_authenticated/parent/family")({
  head: () => ({
    meta: [
      { title: "Family plan — Gradus" },
      {
        name: "description",
        content: "Add another parent or guardian to your athlete and manage your Gradus Family plan.",
      },
      { property: "og:title", content: "Family plan — Gradus" },
      {
        property: "og:description",
        content: "Add another parent or guardian to your athlete and manage your Gradus Family plan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    checkout: typeof search["checkout"] === "string" ? (search["checkout"] as string) : undefined,
  }),
  component: ParentFamilyPage,
});

const PRICES = [
  { id: "family_monthly" as const, label: "Monthly", price: "$15 / month", note: "Cancel anytime" },
  {
    id: "family_yearly" as const,
    label: "Yearly",
    price: "$162 / year",
    note: "Save 10% — two months free",
  },
];

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
  const [busy, setBusy] = useState<string | null>(null);

  // Returning from Stripe — refresh status so the section flips to "active".
  useEffect(() => {
    if (checkout !== "return") return;
    void qc.invalidateQueries({ queryKey: ["family-plan-status"] });
    void qc.invalidateQueries({ queryKey: ["family-guardians"] });
    toast.success("Thanks! Your Family plan is being activated.");
    void navigate({ to: "/parent/family", search: {}, replace: true });
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
            <ArrowLeft className="h-4 w-4" /> Back
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

  const planActive = status.data?.active ?? false;

  return (
    <>
      <PaymentTestModeBanner />
      <div className="mx-auto min-h-dvh max-w-2xl px-3 pt-6 pb-24">
        <PageTitle>Family plan</PageTitle>

        <SettingsGroup label="Your plan">
          <SettingsList>
            <SettingsRow
              icon={<Users className="size-4" />}
              label={planActive ? "Family plan" : "Single parent"}
              description={
                planActive
                  ? "Additional parents and guardians have full access."
                  : "Add another parent or guardian to your athlete for $15/month."
              }
              value={status.isLoading ? "…" : planActive ? (status.data?.status ?? "active") : "Free"}
            />
            {planActive ? (
              <SettingsButtonRow
                icon={<CreditCard className="size-4" />}
                label="Manage billing"
                description="Update your card, invoices, or cancel"
                onClick={() => void handlePortal()}
                disabled={busy === "portal"}
              />
            ) : (
              PRICES.map((p) => (
                <SettingsButtonRow
                  key={p.id}
                  icon={<CreditCard className="size-4" />}
                  label={`${p.label} — ${p.price}`}
                  description={p.note}
                  tone="accent"
                  onClick={() => void handleUpgrade(p.id)}
                  disabled={busy === p.id}
                  trailing={busy === p.id ? <Loader2 className="size-4 animate-spin" /> : undefined}
                />
              ))
            )}
          </SettingsList>
        </SettingsGroup>

        <SettingsGroup label="Guardians">
          {guardians.isLoading ? (
            <p className="px-3 text-sm text-text-tertiary">Loading…</p>
          ) : !guardians.data?.athletes.length ? (
            <p className="px-3 text-sm text-text-tertiary">Add an athlete first.</p>
          ) : (
            <SettingsList>
              {guardians.data.athletes.map((a) => (
                <AthleteGuardians
                  key={a.id}
                  athlete={a}
                  planActive={planActive}
                  onUpgrade={() => void handleUpgrade("family_monthly")}
                />
              ))}
            </SettingsList>
          )}
        </SettingsGroup>

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
    <SettingsDisclosure
      icon={<Users className="size-4" />}
      label={`${athlete.firstName} ${athlete.lastName}`.trim()}
      description={`${athlete.guardians.length} guardian${athlete.guardians.length === 1 ? "" : "s"}`}
    >
      <div className="space-y-4">
        <ul className="space-y-2">
          {athlete.guardians.map((g) => (
            <li key={g.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-text-primary">
                {g.name} {g.isSelf && <span className="text-text-tertiary">(you)</span>}
              </span>
              <span className="text-xs text-text-tertiary">
                {g.role === "primary" ? "Primary" : "Guardian"}
              </span>
              {g.role === "co" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
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
          <ul className="space-y-2">
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
          <div className="flex items-center gap-2">
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
          <div className="space-y-2">
            <p className="text-sm text-text-secondary">
              Adding another parent or guardian is part of the Family plan.
            </p>
            <Button type="button" onClick={onUpgrade}>
              <Mail className="size-4" />
              <span className="ml-1">Upgrade to invite</span>
            </Button>
          </div>
        )}
      </div>
    </SettingsDisclosure>
  );
}

/** Accept an invite you were given as a code (rather than a link). */
function JoinByCodeSection() {
  const qc = useQueryClient();
  const claim = useServerFn(claimGuardianInvite);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <SettingsGroup label="Have an invite code?">
      <SettingsList>
        <div className="flex items-center gap-2 px-4 py-3">
          <KeyRound className="size-4 shrink-0 text-text-tertiary" />
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
      </SettingsList>
    </SettingsGroup>
  );
}
