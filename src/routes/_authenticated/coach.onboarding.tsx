import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SportMultiselect,
  slugifySport,
  type SelectedSport,
} from "@/components/onboarding/sport-multiselect";
import { SPORTS, getSport, getSportLevel, getSuggestedHours, DEFAULT_SUGGESTED_HOURS } from "@/lib/coach-sports";
import {
  coachProfileQueryOptions,
  useCoachProfile,
  useCompleteOnboarding,
  useSaveCoachLevels,
  useSaveCoachProfile,
} from "@/hooks/use-coach-profile";

import { claimParentInvite } from "@/lib/parent-signup.functions";
import { claimOrganizationInviteCode } from "@/lib/coach-org.functions";

import { InviteCard } from "@/components/onboarding/invite-card";

import { CoachPathChoice, type CoachPathValue } from "@/components/onboarding/coach-path-choice";
import { savePendingPromoCode } from "@/lib/pending-promo-code";
import { CoachBottomNav } from "@/components/coach/bottom-nav";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const PENDING_INVITE_KEY = "gradus.pendingParentInvite";

const searchSchema = z.object({
  org: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z2-9]{8}$/)
    .optional(),
  promo: z.string().trim().toUpperCase().max(32).optional(),
});

export const Route = createFileRoute("/_authenticated/coach/onboarding")({
  validateSearch: (s) => searchSchema.parse(s),
  component: OnboardingPage,
});


type LevelEntry = { sport: string; levelKey: string; hoursPerWeek: number };
type CustomLevel = { sportKey: string; key: string; label: string };

function randSuffix() {
  return Math.random().toString(36).slice(2, 7);
}

function prettify(s: string) {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function OnboardingPage() {
  const { data, isLoading, error } = useQuery(coachProfileQueryOptions);
  const navigate = useNavigate();
  const search = Route.useSearch();

  useEffect(() => {
    if (data?.profile.onboardedAt) navigate({ to: "/coach" });
  }, [data?.profile.onboardedAt, navigate]);

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
  return <OnboardingForm data={data} initialOrg={search.org} initialPromo={search.promo} />;
}

type OnboardingData = NonNullable<ReturnType<typeof useCoachProfile>["data"]>;

function OnboardingForm({
  data,
  initialOrg,
  initialPromo,
}: {
  data: OnboardingData;
  initialOrg?: string;
  initialPromo?: string;
}) {
  const navigate = useNavigate();

  const needsName =
    !data.profile.firstName.trim() || !data.profile.lastName.trim();

  const alreadyClub = data.profile.entitlement === "club_covered";

  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState(data.profile.firstName);
  const [lastName, setLastName] = useState(data.profile.lastName);
  const [pathValue, setPathValue] = useState<CoachPathValue>(() => {
    if (alreadyClub && data.profile.organizationName) {
      return {
        path: "club",
        promoCode: "",
        orgCode: "",
        orgName: data.profile.organizationName,
        orgVerified: true,
      };
    }
    if (initialOrg) {
      return { path: "club", promoCode: "", orgCode: initialOrg, orgName: null, orgVerified: false };
    }
    return {
      path: initialPromo ? "individual" : null,
      promoCode: initialPromo ?? "",
      orgCode: "",
      orgName: null,
      orgVerified: false,
    };
  });
  const promoCode = pathValue.promoCode;
  const [_promoOpen, setPromoOpen] = useState<boolean>(false);
  useEffect(() => {
    if (promoCode) setPromoOpen(true);
  }, [promoCode]);




  // Initial sport & custom-level reconstruction from saved data.
  const { initialSports, initialCustomLevels } = useMemo(() => {
    const uniqueSportKeys = Array.from(new Set(data.levels.map((l) => l.sport)));
    const sports: SelectedSport[] = uniqueSportKeys.map((key) => {
      const builtIn = getSport(key);
      if (builtIn) return { key: builtIn.key, label: builtIn.label, custom: false };
      return { key, label: prettify(key.replace(/^custom_/, "")), custom: true };
    });
    const customLevels: CustomLevel[] = [];
    for (const lvl of data.levels) {
      const builtInSport = getSport(lvl.sport);
      if (builtInSport && builtInSport.levels.some((l) => l.key === lvl.levelKey)) {
        continue;
      }
      // Custom sport, or unknown level on a built-in (treat as custom level).
      if (!customLevels.some((c) => c.sportKey === lvl.sport && c.key === lvl.levelKey)) {
        customLevels.push({
          sportKey: lvl.sport,
          key: lvl.levelKey,
          label: prettify(lvl.levelKey.replace(/^lvl_/, "")),
        });
      }
    }
    return { initialSports: sports, initialCustomLevels: customLevels };
  }, [data.levels]);

  const [sports, setSports] = useState<SelectedSport[]>(initialSports);
  const [customLevels, setCustomLevels] = useState<CustomLevel[]>(initialCustomLevels);
  const [entries, setEntries] = useState<LevelEntry[]>(data.levels);

  const customSports = useMemo(
    () => sports.filter((s) => s.custom),
    [sports],
  );

  const saveProfile = useSaveCoachProfile();
  const saveLevels = useSaveCoachLevels();
  const complete = useCompleteOnboarding();

  // Resolve sport metadata regardless of built-in/custom.
  const getSportMeta = (key: string): { label: string; standard?: string; custom: boolean } => {
    const builtIn = getSport(key);
    if (builtIn) return { label: builtIn.label, standard: builtIn.standard, custom: false };
    const custom = sports.find((s) => s.key === key);
    return { label: custom?.label ?? prettify(key), custom: true };
  };

  const getLevelLabel = (sportKey: string, levelKey: string): string => {
    const lvl = getSportLevel(sportKey, levelKey);
    if (lvl) return lvl.label;
    const custom = customLevels.find((c) => c.sportKey === sportKey && c.key === levelKey);
    return custom?.label ?? prettify(levelKey);
  };

  const toggleSport = (sport: SelectedSport) => {
    setSports((prev) => {
      if (prev.some((s) => s.key === sport.key)) {
        setEntries((es) => es.filter((e) => e.sport !== sport.key));
        return prev.filter((s) => s.key !== sport.key);
      }
      return [...prev, sport];
    });
  };

  const addCustomSport = (rawLabel: string) => {
    const label = rawLabel.trim();
    const slug = slugifySport(label);

    // Check built-ins by key or label slug.
    const builtInMatch = SPORTS.find(
      (s) => s.key === slug || slugifySport(s.label) === slug,
    );
    if (builtInMatch) {
      const existing: SelectedSport = {
        key: builtInMatch.key,
        label: builtInMatch.label,
        custom: false,
      };
      setSports((prev) =>
        prev.some((s) => s.key === existing.key) ? prev : [...prev, existing],
      );
      return { status: "selected-existing" as const, label: builtInMatch.label };
    }

    // Check existing custom sports by label slug.
    const customMatch = sports.find(
      (s) => s.custom && slugifySport(s.label) === slug,
    );
    if (customMatch) {
      // Already in selected list — nothing to add, but report.
      return { status: "selected-existing" as const, label: customMatch.label };
    }

    const key = `custom_${slug}_${randSuffix()}`;
    setSports((prev) => [...prev, { key, label, custom: true }]);
    return { status: "added" as const, label };
  };

  const removeCustomSport = (key: string) => {
    setSports((prev) => prev.filter((s) => s.key !== key));
    setCustomLevels((prev) => prev.filter((c) => c.sportKey !== key));
    setEntries((es) => es.filter((e) => e.sport !== key));
  };

  const toggleLevel = (sport: string, levelKey: string) => {
    setEntries((prev) => {
      const exists = prev.some((e) => e.sport === sport && e.levelKey === levelKey);
      if (exists) return prev.filter((e) => !(e.sport === sport && e.levelKey === levelKey));
      return [...prev, { sport, levelKey, hoursPerWeek: getSuggestedHours(sport, levelKey) }];
    });
  };

  const addCustomLevel = (sportKey: string) => {
    const key = `lvl_new_${randSuffix()}`;
    setCustomLevels((prev) => [...prev, { sportKey, key, label: "" }]);
    setEntries((prev) => [...prev, { sport: sportKey, levelKey: key, hoursPerWeek: DEFAULT_SUGGESTED_HOURS }]);
  };

  const updateCustomLevelLabel = (sportKey: string, levelKey: string, label: string) => {
    setCustomLevels((prev) =>
      prev.map((c) =>
        c.sportKey === sportKey && c.key === levelKey ? { ...c, label } : c,
      ),
    );
  };

  const removeCustomLevel = (sportKey: string, levelKey: string) => {
    setCustomLevels((prev) =>
      prev.filter((c) => !(c.sportKey === sportKey && c.key === levelKey)),
    );
    setEntries((prev) =>
      prev.filter((e) => !(e.sport === sportKey && e.levelKey === levelKey)),
    );
  };

  const updateHours = (sport: string, levelKey: string, hours: number) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.sport === sport && e.levelKey === levelKey ? { ...e, hoursPerWeek: hours } : e,
      ),
    );
  };

  type StepKind = "path" | "profile" | "sports" | "levels" | "hours" | "invite" | "review";
  const stepOrder: StepKind[] = needsName
    ? ["path", "profile", "levels", "hours", "invite", "review"]
    : ["path", "sports", "levels", "hours", "invite", "review"];
  const totalSteps = stepOrder.length;
  const currentKind = stepOrder[step - 1];
  const isLastStep = step === totalSteps;

  const canContinue = (() => {
    if (currentKind === "path") {
      if (pathValue.path === "individual") return true; // promo optional
      if (pathValue.path === "club") return pathValue.orgVerified;
      return false;
    }
    if (currentKind === "profile")
      return (
        firstName.trim().length > 0 &&
        lastName.trim().length > 0 &&
        sports.length > 0
      );
    if (currentKind === "sports") return sports.length > 0;
    if (currentKind === "levels") {
      // Every sport must have at least one entry; for custom sports every level must have a non-empty label.
      const allHaveLevel = sports.every((s) =>
        entries.some((e) => e.sport === s.key),
      );
      const customLabelsOk = customLevels.every((c) => c.label.trim().length > 0);
      return allHaveLevel && customLabelsOk;
    }
    if (currentKind === "hours")
      return entries.every((e) => e.hoursPerWeek >= 0 && e.hoursPerWeek <= 40);
    return true;
  })();

  const claimOrg = useServerFn(claimOrganizationInviteCode);

  const handleContinue = async () => {
    try {
      if (currentKind === "path" && pathValue.path === "club" && !alreadyClub) {
        await claimOrg({ data: { code: pathValue.orgCode } });
      }
      if (currentKind === "profile") {
        await saveProfile.mutateAsync({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        });
      }
      if (currentKind === "levels" || currentKind === "hours") {
        await saveLevels.mutateAsync({ entries });
      }
      setStep((s) => s + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  };

  const claim = useServerFn(claimParentInvite);

  const handleFinish = async () => {
    try {
      await saveLevels.mutateAsync({ entries });
      await complete.mutateAsync();
    } catch (err) {
      console.error("[Onboarding] complete failed", err);
      toast.error(err instanceof Error ? err.message : "Couldn't finish");
      return;
    }
    // Stash any typed promo code; the `_authenticated` layout auto-applies it
    // on the next authed page load (see src/routes/_authenticated.tsx).
    if (promoCode.trim()) savePendingPromoCode(promoCode);
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
          err instanceof Error
            ? `Couldn't link parent: ${err.message}`
            : "Couldn't link parent",
        );
      } finally {
        try {
          localStorage.removeItem(PENDING_INVITE_KEY);
        } catch {
          /* ignore */
        }
      }
    }
    // Route based on entitlement: club coaches straight into the app,
    // individuals to the paywall until Stripe checkout completes.
    if (pathValue.path === "club") {
      navigate({ to: "/coach/roster" });
    } else {
      navigate({ to: "/coach/paywall" });
    }
  };

  const busy = saveProfile.isPending || saveLevels.isPending || complete.isPending;
  

  return (
    <>
    <div className="flex min-h-dvh items-start justify-center px-4 pt-8 pb-24 sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl bg-card p-8 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.15)] sm:p-10">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
            Step {step} of {totalSteps}
          </p>
          <div className="flex gap-1.5">
            {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => (
              <span
                key={n}
                className={`h-1.5 w-6 rounded-full ${
                  n <= step ? "bg-accent" : "bg-divider"
                }`}
              />
            ))}
          </div>
        </div>

        {currentKind === "path" && (
          <Step
            title="How are you joining Gradus?"
            subtitle="Pick the option that fits — you can change this later in Settings."
          >
            <CoachPathChoice value={pathValue} onChange={setPathValue} />
          </Step>
        )}

        {currentKind === "profile" && (
          <Step
            title="Tell us about yourself"
            subtitle="Your athletes will see your name on their lessons."
          >
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
                />
              </div>
            </div>
          </Step>
        )}

        {currentKind === "sports" && (
          <Step title="Which sports do you coach?" subtitle="Pick one or more.">
            <SportMultiselect
              selected={sports}
              customSports={customSports}
              onToggle={toggleSport}
              onAddCustom={addCustomSport}
              onRemoveCustom={removeCustomSport}
            />
          </Step>
        )}

        {currentKind === "levels" && (
          <Step
            title="Which levels do you coach?"
            subtitle="Select every level you actively teach. You can change this later."
          >
            <div className="space-y-8">
              {sports.map((selSport) => {
                const sportKey = selSport.key;
                const meta = getSportMeta(sportKey);
                const builtIn = getSport(sportKey);
                return (
                  <div key={sportKey}>
                    <h2 className="text-xl">{meta.label}</h2>
                    {meta.standard && (
                      <p className="mt-1 text-xs uppercase tracking-wider text-text-secondary">
                        {meta.standard}
                      </p>
                    )}

                    {builtIn ? (
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {builtIn.levels.map((lvl) => {
                          const checked = entries.some(
                            (e) => e.sport === sportKey && e.levelKey === lvl.key,
                          );
                          return (
                            <label
                              key={lvl.key}
                              className="flex cursor-pointer items-start gap-3 rounded-md border border-divider bg-elevated p-3 hover:border-accent/40"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleLevel(sportKey, lvl.key)}
                                className="mt-1 h-4 w-4 accent-accent"
                              />
                              <div className="leading-tight">
                                <div className="text-sm font-semibold text-text-primary">
                                  {lvl.label}
                                </div>
                                {lvl.hint && (
                                  <div className="text-xs text-text-secondary">{lvl.hint}</div>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-4 space-y-2">
                        {customLevels
                          .filter((c) => c.sportKey === sportKey)
                          .map((c) => (
                            <div
                              key={c.key}
                              className="flex items-center gap-2 rounded-md border border-divider bg-elevated p-2"
                            >
                              <Input
                                value={c.label}
                                onChange={(e) =>
                                  updateCustomLevelLabel(sportKey, c.key, e.target.value)
                                }
                                placeholder="Level name (e.g. Beginner)"
                                className="h-9 text-sm"
                                maxLength={60}
                              />
                              <button
                                type="button"
                                onClick={() => removeCustomLevel(sportKey, c.key)}
                                className="rounded p-1.5 text-text-tertiary hover:bg-divider hover:text-text-primary"
                                aria-label="Remove level"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => addCustomLevel(sportKey)}
                        >
                          <Plus className="h-4 w-4" />
                          Add level
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Step>
        )}

        {currentKind === "hours" && (
          <Step
            title="Practice expectations"
            subtitle="How many hours per week should athletes at each level practice on their own?"
          >
            <div className="space-y-3">
              {sports.map((selSport) => {
                const sportKey = selSport.key;
                const meta = getSportMeta(sportKey);
                const sportEntries = entries.filter((e) => e.sport === sportKey);
                if (sportEntries.length === 0) return null;
                return (
                  <div key={sportKey}>
                    <h2 className="text-xl">{meta.label}</h2>
                    <div className="mt-4 space-y-3">
                      {sportEntries.map((entry) => (
                        <div
                          key={entry.levelKey}
                          className="flex items-center justify-between gap-2 rounded-md border border-divider bg-elevated px-4 py-3"
                        >
                          <div className="leading-tight">
                            <div className="text-sm font-semibold text-text-primary">
                              {getLevelLabel(sportKey, entry.levelKey)}
                            </div>
                            <div className="font-hand text-lg text-accent-ink">
                              hrs / week
                            </div>
                          </div>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={40}
                            step={0.5}
                            value={entry.hoursPerWeek === 0 ? "" : entry.hoursPerWeek}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const n = raw === "" ? 0 : Number(raw);
                              updateHours(
                                sportKey,
                                entry.levelKey,
                                Math.max(0, Math.min(40, Number.isFinite(n) ? n : 0)),
                              );
                            }}
                            className="w-24 text-right"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Step>
        )}

        {currentKind === "invite" && (
          <Step title="Invite Parents">
            <InviteCard />
          </Step>
        )}


        {currentKind === "review" && (
          <Step title="Looks good?" subtitle="Review and finish.">
            <ReviewSummary
              firstName={firstName}
              lastName={lastName}
              sports={sports}
              entries={entries}
              getSportMeta={getSportMeta}
              getLevelLabel={getLevelLabel}
            />
          </Step>
        )}

        <div className="mt-6 flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1 || busy}
          >
            Back
          </Button>
          <Button
            onClick={isLastStep ? handleFinish : handleContinue}
            disabled={!canContinue || busy}
          >
            {busy ? "Saving…" : isLastStep ? "Finish" : "Continue"}
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

function ReviewSummary({
  firstName,
  lastName,
  sports,
  entries,
  getSportMeta,
  getLevelLabel,
}: {
  firstName: string;
  lastName: string;
  sports: SelectedSport[];
  entries: LevelEntry[];
  getSportMeta: (key: string) => { label: string; standard?: string; custom: boolean };
  getLevelLabel: (sportKey: string, levelKey: string) => string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs uppercase tracking-wider text-text-secondary">Coach</p>
        <p className="mt-1 text-lg font-semibold text-text-primary">
          {firstName} {lastName}
        </p>
      </div>
      {sports.map((selSport) => {
        const sportKey = selSport.key;
        const meta = getSportMeta(sportKey);
        const sportEntries = entries.filter((e) => e.sport === sportKey);
        return (
          <div key={sportKey}>
            <p className="text-xs uppercase tracking-wider text-text-secondary">
              {meta.label}
            </p>
            <ul className="mt-2 space-y-1">
              {sportEntries.map((e) => (
                <li
                  key={e.levelKey}
                  className="flex justify-between border-b border-divider/60 py-1.5 text-sm"
                >
                  <span className="text-text-primary">
                    {getLevelLabel(sportKey, e.levelKey)}
                  </span>
                  <span className="text-text-secondary">
                    <span className="text-text-primary font-semibold">{e.hoursPerWeek}</span>{" "}
                    <span className="font-hand text-lg text-accent-ink">hrs / week</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
