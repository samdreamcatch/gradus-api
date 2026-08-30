import { useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SportMultiselect,
  slugifySport,
  type SelectedSport,
} from "@/components/onboarding/sport-multiselect";
import { SPORTS, getSport, getSuggestedHours, DEFAULT_SUGGESTED_HOURS } from "@/lib/coach-sports";
import {
  coachProfileQueryOptions,
  useCoachProfile,
  useCompleteOnboarding,
  useSaveCoachLevels,
  useSaveCoachProfile,
} from "@/hooks/use-coach-profile";

import { claimParentInvite } from "@/lib/parent-signup.functions";

import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { isCoachPaywallEnabled, maxPrimarySportsForCoach } from "@/lib/paywall-flag";

import { useQuery } from "@tanstack/react-query";

const PENDING_INVITE_KEY = "gradus.pendingParentInvite";
const ENTITLED = new Set(["paid", "promo_free", "club_covered"]);

export const Route = createFileRoute("/_authenticated/coach/onboarding")({
  beforeLoad: async ({ context }) => {
    const data = await context.queryClient.ensureQueryData(coachProfileQueryOptions);
    if (data.profile.onboardedAt) {
      throw redirect({ to: "/coach" });
    }
    if (isCoachPaywallEnabled() && !ENTITLED.has(data.profile.entitlement)) {
      throw redirect({ to: "/coach/paywall", replace: true });
    }
  },
  component: OnboardingPage,
});

type LevelEntry = { sport: string; levelKey: string; hoursPerWeek: number };

function randSuffix() {
  return Math.random().toString(36).slice(2, 7);
}

function prettify(s: string) {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Coaches no longer pick levels or practice hours during signup — a coach's
 * sport list is derived from `coach_levels`, so every level of each selected
 * sport is saved at the Gradus default. Coaches can tune these later in
 * settings, or per athlete from their roster.
 */
function defaultEntriesForSports(sports: SelectedSport[]): LevelEntry[] {
  const entries: LevelEntry[] = [];
  for (const sel of sports) {
    const builtIn = getSport(sel.key);
    if (builtIn) {
      for (const lvl of builtIn.levels) {
        entries.push({
          sport: sel.key,
          levelKey: lvl.key,
          hoursPerWeek: getSuggestedHours(sel.key, lvl.key),
        });
      }
    } else {
      entries.push({
        sport: sel.key,
        levelKey: "lvl_general",
        hoursPerWeek: DEFAULT_SUGGESTED_HOURS,
      });
    }
  }
  return entries;
}

function OnboardingPage() {
  const { data, isLoading, error } = useQuery(coachProfileQueryOptions);

  const onboardedAt = data?.profile.onboardedAt;
  const needsPaywall = Boolean(
    data && isCoachPaywallEnabled() && !ENTITLED.has(data.profile.entitlement),
  );

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <p className="text-sm text-text-secondary">
          Couldn&apos;t load your coach profile. Please refresh.
        </p>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-text-secondary">
        Loading…
      </div>
    );
  }
  if (onboardedAt || needsPaywall) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-text-secondary">
        Finishing up…
      </div>
    );
  }
  return <OnboardingForm data={data} />;
}

type OnboardingData = NonNullable<ReturnType<typeof useCoachProfile>["data"]>;

function OnboardingForm({ data }: { data: OnboardingData }) {
  const navigate = useNavigate();

  const effectiveTier = data.profile.effectiveTier;
  const distinctPrimarySportCount = useMemo(
    () =>
      new Set(data.levels.map((l) => l.sport).filter((s) => s !== "strength_conditioning")).size,
    [data.levels],
  );
  const primarySportCap = maxPrimarySportsForCoach({
    effectiveTier,
    foundingCoach: data.profile.foundingCoach,
    distinctPrimarySportCount,
  });

  const [firstName, setFirstName] = useState(data.profile.firstName);
  const [lastName, setLastName] = useState(data.profile.lastName);

  const initialSports = useMemo<SelectedSport[]>(() => {
    const uniqueSportKeys = Array.from(new Set(data.levels.map((l) => l.sport)));
    return uniqueSportKeys.map((key) => {
      const builtIn = getSport(key);
      if (builtIn) return { key: builtIn.key, label: builtIn.label, custom: false };
      return { key, label: prettify(key.replace(/^custom_/, "")), custom: true };
    });
  }, [data.levels]);

  const [sports, setSports] = useState<SelectedSport[]>(initialSports);

  const customSports = useMemo(() => sports.filter((s) => s.custom), [sports]);

  const saveProfile = useSaveCoachProfile();
  const saveLevels = useSaveCoachLevels();
  const complete = useCompleteOnboarding();

  const toggleSport = (sport: SelectedSport) => {
    setSports((prev) => {
      if (prev.some((s) => s.key === sport.key)) {
        return prev.filter((s) => s.key !== sport.key);
      }
      return [...prev, sport];
    });
  };

  const addCustomSport = (rawLabel: string) => {
    const label = rawLabel.trim();
    const slug = slugifySport(label);

    // Check built-ins by key or label slug.
    const builtInMatch = SPORTS.find((s) => s.key === slug || slugifySport(s.label) === slug);
    if (builtInMatch) {
      const existing: SelectedSport = {
        key: builtInMatch.key,
        label: builtInMatch.label,
        custom: false,
      };
      setSports((prev) => (prev.some((s) => s.key === existing.key) ? prev : [...prev, existing]));
      return { status: "selected-existing" as const, label: builtInMatch.label };
    }

    // Check existing custom sports by label slug.
    const customMatch = sports.find((s) => s.custom && slugifySport(s.label) === slug);
    if (customMatch) {
      return { status: "selected-existing" as const, label: customMatch.label };
    }

    const key = `custom_${slug}_${randSuffix()}`;
    setSports((prev) => [...prev, { key, label, custom: true }]);
    return { status: "added" as const, label };
  };

  const removeCustomSport = (key: string) => {
    setSports((prev) => prev.filter((s) => s.key !== key));
  };

  const canContinue =
    firstName.trim().length > 0 && lastName.trim().length > 0 && sports.length > 0;

  const claim = useServerFn(claimParentInvite);

  const handleFinish = async () => {
    try {
      await saveProfile.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      await saveLevels.mutateAsync({ entries: defaultEntriesForSports(sports) });
      await complete.mutateAsync();
    } catch (err) {
      console.error("[Onboarding] complete failed", err);
      toast.error(err instanceof Error ? err.message : "Couldn't finish");
      return;
    }
    let pendingInvite: string | null = null;
    try {
      pendingInvite = localStorage.getItem(PENDING_INVITE_KEY);
    } catch {
      /* ignore */
    }
    if (pendingInvite) {
      try {
        await claim({ data: { code: pendingInvite } });
        toast.success("Linked to the parent's account");
      } catch (err) {
        console.error("[Onboarding] claim invite failed", err);
        toast.error(
          err instanceof Error ? `Couldn't link parent: ${err.message}` : "Couldn't link parent",
        );
      } finally {
        try {
          localStorage.removeItem(PENDING_INVITE_KEY);
        } catch {
          /* ignore */
        }
      }
    }
    // Coach already selected & activated their plan at /coach/paywall before
    // reaching onboarding, so head straight into the app.
    navigate({ to: "/coach/roster" });
  };

  const busy = saveProfile.isPending || saveLevels.isPending || complete.isPending;

  return (
    <>
      <div className="flex min-h-dvh items-start justify-center px-4 pt-8 pb-app-chrome sm:items-center">
        <div className="w-full max-w-2xl rounded-2xl bg-card p-8 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.15)] sm:p-10">
          <Step title="Tell us about yourself">
            <div className="space-y-6">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    maxLength={80}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    maxLength={80}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Which sports do you coach?</Label>
                <SportMultiselect
                  selected={sports}
                  customSports={customSports}
                  onToggle={toggleSport}
                  onAddCustom={addCustomSport}
                  onRemoveCustom={removeCustomSport}
                  maxPrimarySports={primarySportCap}
                />
              </div>
            </div>
          </Step>

          <div className="mt-6 flex justify-end">
            <Button onClick={handleFinish} disabled={!canContinue || busy}>
              {busy ? "Saving…" : "Finish"}
            </Button>
          </div>
        </div>
      </div>
      <CoachBottomNav />
    </>
  );
}

function Step({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="text-3xl sm:text-4xl">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-text-secondary">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </div>
  );
}
