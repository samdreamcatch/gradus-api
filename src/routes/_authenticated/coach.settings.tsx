import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  LogOut,
  Mail,
  Palette,
  User,
  Dumbbell,
  CreditCard,
  Sparkles,
  Building2,
  Tag,
  ArrowLeftRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SportMultiselect, type SelectedSport } from "@/components/onboarding/sport-multiselect";
import { SPORTS, getSport, type SportKey } from "@/lib/coach-sports";
import {
  coachProfileQueryOptions,
  useSaveCoachLevels,
  useSaveCoachProfile,
} from "@/hooks/use-coach-profile";
import { coachInviteQueryOptions } from "@/hooks/use-coach-invite";
import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { RosterSettingsSection } from "@/components/coach/roster-settings-section";
import { ConnectPeopleSheet } from "@/components/coach/connect-people-sheet";
import { CoachVisibilitySettingsRow } from "@/components/coach/coach-visibility-sheet";
import { JoinClubSheet } from "@/components/coach/join-club-sheet";
import { UpgradeToProRow } from "@/components/coach/upgrade-to-pro-row";
import { createCoachBillingPortalSession } from "@/lib/coach-checkout.functions";
import { getStripeEnvironment } from "@/lib/stripe-env";
import { maxPrimarySportsForCoach } from "@/lib/paywall-flag";

import {
  SettingsGroup,
  SettingsList,
  SettingsRow,
  SettingsButtonRow,
  SettingsDisclosure,
} from "@/components/settings/primitives";
import { PageTitle } from "@/components/page-title";
import { ThemeSelect } from "@/components/settings/theme-select";
import { useCurrentUserEmail } from "@/hooks/use-current-user-email";
import { FeedbackSettingsRow } from "@/components/feedback/feedback-fab";
import { InstallAppRow } from "@/components/settings/install-app-row";
import { NativeAppSection } from "@/components/settings/native-app-section";
import { AccountSecuritySection } from "@/components/settings/account-security-section";
import { openExternal } from "@/lib/native";

export const Route = createFileRoute("/_authenticated/coach/settings")({
  loader: ({ context }) => {
    context.queryClient.prefetchQuery(coachInviteQueryOptions);
    return context.queryClient.ensureQueryData(coachProfileQueryOptions);
  },
  component: SettingsPage,
});

type LevelEntry = { sport: string; levelKey: string; hoursPerWeek: number };

function SettingsPage() {
  const { data } = useSuspenseQuery(coachProfileQueryOptions);
  const email = useCurrentUserEmail();
  const sportsSummary =
    Array.from(new Set(data.levels.map((l) => getSport(l.sport)?.label ?? l.sport))).join(", ") ||
    "None yet";

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-2xl px-3 pt-6 pb-24">
        <PageTitle>Settings</PageTitle>

        <SettingsGroup label="My profile">
          <SettingsList>
            <NameDisclosure firstName={data.profile.firstName} lastName={data.profile.lastName} />
            <SettingsRow icon={<Mail className="size-4" />} label="Email" value={email ?? "—"} />
          </SettingsList>
        </SettingsGroup>

        <SettingsGroup label="Coaching">
          <SettingsList>
            <SportsDisclosure
              levels={data.levels}
              summary={sportsSummary}
              effectiveTier={data.profile.effectiveTier}
              foundingCoach={data.profile.foundingCoach}
            />

            <RosterSettingsSection />

            <CoachVisibilitySettingsRow />
          </SettingsList>
          <div className="mt-3">
            <ConnectPeopleSheet />
          </div>
        </SettingsGroup>

        <SettingsGroup label="Plan">
          <PlanSection profile={data.profile} />
        </SettingsGroup>

        <SettingsGroup label="Preferences">
          <SettingsList>
            <SettingsRow
              icon={<Palette className="size-4" />}
              label="Appearance"
              trailing={<ThemeSelect />}
            />
          </SettingsList>
        </SettingsGroup>

        <AccountSecuritySection />

        <SettingsGroup>
          <SettingsList>
            <InstallAppRow />
            <NativeAppSection />
            <FeedbackSettingsRow />
            <SignOutRow />
          </SettingsList>
        </SettingsGroup>
      </div>
      <CoachBottomNav />
    </>
  );
}

function NameDisclosure({ firstName: f0, lastName: l0 }: { firstName: string; lastName: string }) {
  const [firstName, setFirstName] = useState(f0);
  const [lastName, setLastName] = useState(l0);
  const save = useSaveCoachProfile();

  const handleSave = async () => {
    try {
      await save.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      toast.success("Name saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  };

  return (
    <SettingsDisclosure
      icon={<User className="size-4" />}
      label="Name"
      value={`${f0} ${l0}`.trim() || "—"}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">First name</Label>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={80} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Last name</Label>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={80} />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={save.isPending || firstName.trim().length === 0 || lastName.trim().length === 0}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </SettingsDisclosure>
  );
}

function SportsDisclosure({
  levels,
  summary,
  effectiveTier,
  foundingCoach,
}: {
  levels: LevelEntry[];
  summary: string;
  effectiveTier: "coach" | "coach_pro" | "club";
  foundingCoach: boolean;
}) {
  const initialSports = useMemo(
    () => Array.from(new Set(levels.map((l) => l.sport))) as SportKey[],
    [levels],
  );
  const [sports, setSports] = useState<SportKey[]>(initialSports);
  const [entries, setEntries] = useState<LevelEntry[]>(levels);
  const save = useSaveCoachLevels();
  const distinctPrimarySportCount = useMemo(
    () => new Set(levels.map((l) => l.sport).filter((s) => s !== "strength_conditioning")).size,
    [levels],
  );
  const maxPrimarySports = maxPrimarySportsForCoach({
    effectiveTier,
    foundingCoach,
    distinctPrimarySportCount,
  });

  useEffect(() => {
    setSports(initialSports);
    setEntries(levels);
  }, [initialSports, levels]);

  const toggleSport = (key: SportKey) => {
    setSports((prev) => {
      if (prev.includes(key)) {
        setEntries((es) => es.filter((e) => e.sport !== key));
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  };

  const toggleLevel = (sport: SportKey, levelKey: string) => {
    setEntries((prev) => {
      const exists = prev.some((e) => e.sport === sport && e.levelKey === levelKey);
      if (exists) return prev.filter((e) => !(e.sport === sport && e.levelKey === levelKey));
      const lvl = getSport(sport)?.levels.find((l) => l.key === levelKey);
      return [...prev, { sport, levelKey, hoursPerWeek: lvl?.suggestedHours ?? 0 }];
    });
  };

  const updateHours = (sport: string, levelKey: string, hours: number) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.sport === sport && e.levelKey === levelKey ? { ...e, hoursPerWeek: hours } : e,
      ),
    );
  };

  const handleSave = async () => {
    try {
      await save.mutateAsync({ entries });
      toast.success("Sports saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  };

  const valid = sports.length > 0 && sports.every((s) => entries.some((e) => e.sport === s));

  return (
    <SettingsDisclosure
      icon={<Dumbbell className="size-4" />}
      label="Sports & levels"
      description="Levels you coach and weekly practice expectations"
      value={summary}
    >
      <div className="space-y-5">
        <div>
          <Label className="mb-2 block text-xs">Sports you coach</Label>
          <SportMultiselect
            allowCustom={false}
            customSports={[]}
            selected={sports.map(
              (k): SelectedSport => ({
                key: k,
                label: getSport(k)?.label ?? k,
                custom: false,
              }),
            )}
            onToggle={(s) => toggleSport(s.key as SportKey)}
            onAddCustom={() => ({ status: "added", label: "" })}
            onRemoveCustom={() => {}}
            maxPrimarySports={maxPrimarySports}
          />
        </div>

        {sports.map((sportKey) => {
          const sport = getSport(sportKey)!;
          const sportEntries = entries.filter((e) => e.sport === sportKey);
          return (
            <div key={sportKey} className="rounded-xl border border-divider bg-card/60 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-base text-text-primary">{sport.label}</h3>
                <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
                  {sport.standard}
                </span>
              </div>
              <div className="mt-3 grid gap-1.5">
                {sport.levels.map((lvl) => {
                  const entry = sportEntries.find((e) => e.levelKey === lvl.key);
                  const checked = !!entry;
                  return (
                    <label
                      key={lvl.key}
                      className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-elevated/60"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleLevel(sportKey, lvl.key)}
                      />
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="text-sm text-text-primary">{lvl.label}</div>
                        {lvl.hint && (
                          <div className="text-[11px] text-text-tertiary">{lvl.hint}</div>
                        )}
                      </div>
                      {checked && (
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={40}
                            step={0.5}
                            value={entry!.hoursPerWeek === 0 ? "" : entry!.hoursPerWeek}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const n = raw === "" ? 0 : Number(raw);
                              updateHours(
                                sportKey,
                                lvl.key,
                                Math.max(0, Math.min(40, Number.isFinite(n) ? n : 0)),
                              );
                            }}
                            className="h-8 w-16 text-right text-sm"
                          />
                          <span className="text-[11px] text-text-tertiary">hr/wk</span>
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={save.isPending || !valid}>
            {save.isPending ? "Saving…" : "Save sports"}
          </Button>
        </div>
      </div>
    </SettingsDisclosure>
  );
}

const TIER_LABEL: Record<"coach" | "coach_pro", string> = {
  coach: "Coach plan",
  coach_pro: "Coach Pro plan",
};

function formatShortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function PlanSection({
  profile,
}: {
  profile: {
    entitlement: "pending" | "paid" | "club_covered" | "promo_free";
    subscriptionTier: "coach" | "coach_pro" | null;
    subscriptionStatus: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    hasStripeCustomer: boolean;
    organizationName: string | null;
    promoCode: string | null;
    promoLabel: string | null;
    promoPercentOff: number;
    foundingCoach: boolean;
    trialNeedsCard: boolean;
    billingPastDue: boolean;
    freeAccessUntil?: string | null;
  };
}) {
  const navigate = useNavigate();
  const portal = useServerFn(createCoachBillingPortalSession);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const hasPaidSub =
    profile.entitlement === "paid" &&
    !!profile.subscriptionTier &&
    profile.subscriptionStatus !== "canceled";

  const joinClubRow = (
    <SettingsButtonRow
      icon={<Building2 className="size-4" />}
      label="Join a club"
      description="Your club covers your plan — enter their code to switch."
      onClick={() => setJoinOpen(true)}
    />
  );
  const joinSheet = (
    <JoinClubSheet
      open={joinOpen}
      onOpenChange={setJoinOpen}
      hasPaidSubscription={hasPaidSub}
      paidInterval={null}
    />
  );

  const openPortal = async () => {
    setOpeningPortal(true);
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
      void openExternal(res.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open billing portal");
    } finally {
      setOpeningPortal(false);
    }
  };

  const promoRow = null;

  // Club-covered coaches
  if (profile.entitlement === "club_covered") {
    return (
      <PlanSummaryCard
        icon={<Building2 className="size-4" />}
        label={profile.organizationName ?? "Club plan"}
        description="Club plan · your club covers your subscription."
        extras={promoRow ? <SettingsList>{promoRow}</SettingsList> : null}
      />
    );
  }

  // Paid — coach or coach pro. Checked before the founding-coach branch so
  // a founding coach who has upgraded to Coach Pro sees their paid plan.
  if (profile.entitlement === "paid" && profile.subscriptionTier) {
    const status = profile.subscriptionStatus;
    const trialEnd = formatShortDate(profile.trialEndsAt);
    const periodEnd = formatShortDate(profile.currentPeriodEnd);

    let description: string | undefined;
    if (status === "trialing" && trialEnd) {
      description = `Free trial — your card is charged on ${trialEnd}.`;
    } else if (profile.billingPastDue) {
      description = "Payment failed — update your card in the billing portal.";
    } else if (status === "canceled" && periodEnd) {
      description = `Ends ${periodEnd}. Reactivate anytime.`;
    } else if (status === "active" && periodEnd) {
      description = `Renews ${periodEnd}.`;
    }

    const isFoundingPro = profile.foundingCoach && profile.subscriptionTier === "coach_pro";
    const statusPill = isFoundingPro
      ? { label: "Founding · Pro", tone: "accent" as const }
      : status === "trialing"
        ? { label: "Trial", tone: "accent" as const }
        : profile.billingPastDue
          ? { label: "Payment failed", tone: "destructive" as const }
          : status === "canceled"
            ? { label: "Canceling", tone: "muted" as const }
            : status === "active"
              ? { label: "Active", tone: "accent" as const }
              : null;

    return (
      <>
        <PlanSummaryCard
          icon={<CreditCard className="size-4" />}
          label={TIER_LABEL[profile.subscriptionTier]}
          description={description}
          status={statusPill}
        />
        <SettingsList className="mt-3">
          {promoRow}

          {profile.trialNeedsCard && (
            <SettingsButtonRow
              icon={<CreditCard className="size-4" />}
              label="Add a payment method"
              description="Required to keep your plan when your free trial ends."
              tone="accent"
              onClick={() => void openPortal()}
              disabled={openingPortal || !profile.hasStripeCustomer}
            />
          )}

          <SettingsButtonRow
            icon={<CreditCard className="size-4" />}
            label={openingPortal ? "Opening billing portal…" : "Manage billing"}
            description="Change card or download invoices."
            onClick={() => void openPortal()}
            disabled={openingPortal || !profile.hasStripeCustomer}
          />
          <SettingsButtonRow
            icon={<ArrowLeftRight className="size-4" />}
            label="Change plan"
            description={
              profile.subscriptionTier === "coach_pro"
                ? "Switch to Coach or apply a promo."
                : "Switch tier or apply a promo."
            }
            onClick={() => navigate({ to: "/coach/paywall", search: { manage: true } })}
          />

          {joinClubRow}
        </SettingsList>
        {joinSheet}
      </>
    );
  }

  // Founding Coach — lifetime-free grandfather cohort on the free Coach tier.
  // Only shown when they don't already have a paid Coach Pro subscription
  // (that case is handled above).
  if (profile.foundingCoach) {
    return (
      <>
        <PlanSummaryCard
          icon={<Sparkles className="size-4" />}
          label="Founding Coach"
          description="Thank you for being here early."
          status={{ label: "Coach · Free", tone: "accent" }}
        />
        <SettingsList className="mt-3">
          <UpgradeToProRow />
          {joinClubRow}
        </SettingsList>
        {joinSheet}
      </>
    );
  }

  // Complimentary access
  if (profile.entitlement === "promo_free") {
    const freeUntil = formatShortDate(profile.freeAccessUntil ?? null);
    return (
      <>
        <PlanSummaryCard
          icon={<Sparkles className="size-4" />}
          label={freeUntil ? "Free access" : "Complimentary access"}
          description={
            freeUntil
              ? `Your club seat ended — you're free until ${freeUntil}. Pick a plan any time.`
              : "Your account is on the house — no card required."
          }
          status={freeUntil ? { label: `Free until ${freeUntil}`, tone: "accent" } : undefined}
          extras={promoRow ? <SettingsList>{promoRow}</SettingsList> : null}
        />
        {freeUntil ? (
          <SettingsList className="mt-3">
            <SettingsButtonRow
              icon={<Sparkles className="size-4" />}
              label="Choose a plan"
              tone="accent"
              onClick={() => navigate({ to: "/coach/paywall" })}
            />
            {joinClubRow}
          </SettingsList>
        ) : null}
        {freeUntil ? joinSheet : null}
      </>
    );
  }

  // No plan yet — pending.
  return (
    <>
      <PlanSummaryCard
        icon={<CreditCard className="size-4" />}
        label="No plan yet"
        description="Pick a Coach or Coach Pro plan to keep coaching after your 90-day trial."
      />
      <SettingsList className="mt-3">
        {promoRow}
        <SettingsButtonRow
          icon={<Sparkles className="size-4" />}
          label="Choose a plan"
          tone="accent"
          onClick={() => navigate({ to: "/coach/paywall" })}
        />
        {joinClubRow}
      </SettingsList>
      {joinSheet}
    </>
  );
}

function PlanSummaryCard({
  icon,
  label,
  description,
  status,
  extras,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
  status?: { label: string; tone: "accent" | "destructive" | "muted" } | null;
  extras?: React.ReactNode;
}) {
  const toneClass =
    status?.tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : status?.tone === "muted"
        ? "bg-elevated text-text-secondary"
        : "bg-accent/10 text-accent-ink";
  return (
    <>
      <div className="rounded-2xl border border-divider bg-elevated/60 px-4 py-4 backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate font-display text-base text-text-primary">{label}</div>
              {status && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                    toneClass,
                  )}
                >
                  {status.label}
                </span>
              )}
            </div>
            {description && <p className="mt-1 text-xs text-text-secondary">{description}</p>}
          </div>
        </div>
      </div>
      {extras}
    </>
  );
}

function SignOutRow() {
  const navigate = useNavigate();
  return (
    <SettingsButtonRow
      icon={<LogOut className="size-4" />}
      label="Sign out"
      tone="destructive"
      onClick={async () => {
        await supabase.auth.signOut();
        navigate({ to: "/login" });
      }}
    />
  );
}
