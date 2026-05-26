import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SportChip } from "@/components/onboarding/sport-chip";
import { SPORTS, getSport, getSportLevel, type SportKey } from "@/lib/coach-sports";
import {
  coachProfileQueryOptions,
  useCompleteOnboarding,
  useSaveCoachLevels,
  useSaveCoachProfile,
} from "@/hooks/use-coach-profile";
import { coachInviteQueryOptions } from "@/hooks/use-coach-invite";
import { InviteCard } from "@/components/onboarding/invite-card";
import { useSuspenseQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/onboarding")({
  loader: ({ context }) => {
    // Prime both queries — invite is shown on step 5.
    context.queryClient.prefetchQuery(coachInviteQueryOptions);
    return context.queryClient.ensureQueryData(coachProfileQueryOptions);
  },
  component: OnboardingPage,
});

type LevelEntry = { sport: string; levelKey: string; hoursPerWeek: number };

function OnboardingPage() {
  const { data } = useSuspenseQuery(coachProfileQueryOptions);
  const navigate = useNavigate();

  // If already onboarded, bounce to /coach
  useEffect(() => {
    if (data.profile.onboardedAt) navigate({ to: "/coach" });
  }, [data.profile.onboardedAt, navigate]);

  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState(data.profile.firstName);
  const [lastName, setLastName] = useState(data.profile.lastName);

  const initialSports = useMemo(
    () => Array.from(new Set(data.levels.map((l) => l.sport))) as SportKey[],
    [data.levels],
  );
  const [sports, setSports] = useState<SportKey[]>(initialSports);

  const [entries, setEntries] = useState<LevelEntry[]>(data.levels);

  const saveProfile = useSaveCoachProfile();
  const saveLevels = useSaveCoachLevels();
  const complete = useCompleteOnboarding();

  const toggleSport = (key: SportKey) => {
    setSports((prev) => {
      if (prev.includes(key)) {
        // Also drop entries for that sport
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
      return [...prev, { sport, levelKey, hoursPerWeek: 0 }];
    });
  };

  const updateHours = (sport: string, levelKey: string, hours: number) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.sport === sport && e.levelKey === levelKey ? { ...e, hoursPerWeek: hours } : e,
      ),
    );
  };

  const canContinue = (() => {
    if (step === 1) return firstName.trim().length > 0 && lastName.trim().length > 0;
    if (step === 2) return sports.length > 0;
    if (step === 3) return sports.every((s) => entries.some((e) => e.sport === s));
    if (step === 4) return entries.every((e) => e.hoursPerWeek >= 0 && e.hoursPerWeek <= 40);
    return true;
  })();

  const handleContinue = async () => {
    try {
      if (step === 1) {
        await saveProfile.mutateAsync({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        });
      }
      if (step === 3 || step === 4) {
        await saveLevels.mutateAsync({ entries });
      }
      setStep((s) => s + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  };

  const handleFinish = async () => {
    try {
      await saveLevels.mutateAsync({ entries });
      await complete.mutateAsync();
      navigate({ to: "/coach" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't finish");
    }
  };

  const busy = saveProfile.isPending || saveLevels.isPending || complete.isPending;

  return (
    <div className="flex min-h-dvh items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl bg-card p-8 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.15)] sm:p-10">
        <div className="mb-8 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
            Step {step} of 6
          </p>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <span
                key={n}
                className={`h-1.5 w-6 rounded-full ${
                  n <= step ? "bg-accent" : "bg-divider"
                }`}
              />
            ))}
          </div>
        </div>

        {step === 1 && (
          <Step
            title="What's your name?"
            subtitle="Your athletes will see this on their lessons."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoFocus
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
          </Step>
        )}

        {step === 2 && (
          <Step title="Which sports do you coach?" subtitle="Pick one or more.">
            <div className="flex flex-wrap gap-3">
              {SPORTS.map((s) => (
                <SportChip
                  key={s.key}
                  selected={sports.includes(s.key)}
                  onClick={() => toggleSport(s.key)}
                >
                  {s.label}
                </SportChip>
              ))}
            </div>
          </Step>
        )}

        {step === 3 && (
          <Step
            title="Which levels do you coach?"
            subtitle="Select every level you actively teach. You can change this later."
          >
            <div className="space-y-8">
              {sports.map((sportKey) => {
                const sport = getSport(sportKey)!;
                return (
                  <div key={sportKey}>
                    <h3 className="text-xl">{sport.label}</h3>
                    <p className="mt-1 text-xs uppercase tracking-wider text-text-secondary">
                      {sport.standard}
                    </p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {sport.levels.map((lvl) => {
                        const checked = entries.some(
                          (e) => e.sport === sportKey && e.levelKey === lvl.key,
                        );
                        return (
                          <label
                            key={lvl.key}
                            className="flex cursor-pointer items-start gap-3 rounded-md border border-divider bg-elevated p-3 hover:border-accent/40"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleLevel(sportKey, lvl.key)}
                              className="mt-0.5"
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
                  </div>
                );
              })}
            </div>
          </Step>
        )}

        {step === 4 && (
          <Step
            title="Practice expectations"
            subtitle="How many hours per week should athletes at each level practice on their own?"
          >
            <div className="space-y-6">
              {sports.map((sportKey) => {
                const sport = getSport(sportKey)!;
                const sportEntries = entries.filter((e) => e.sport === sportKey);
                if (sportEntries.length === 0) return null;
                return (
                  <div key={sportKey}>
                    <h3 className="text-xl">{sport.label}</h3>
                    <div className="mt-4 space-y-3">
                      {sportEntries.map((entry) => {
                        const lvl = getSportLevel(sportKey, entry.levelKey)!;
                        return (
                          <div
                            key={entry.levelKey}
                            className="flex items-center justify-between gap-4 rounded-md border border-divider bg-elevated px-4 py-3"
                          >
                            <div className="leading-tight">
                              <div className="text-sm font-semibold text-text-primary">
                                {lvl.label}
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
                              value={entry.hoursPerWeek}
                              onChange={(e) =>
                                updateHours(
                                  sportKey,
                                  entry.levelKey,
                                  Math.max(0, Math.min(40, Number(e.target.value) || 0)),
                                )
                              }
                              className="w-24 text-right"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Step>
        )}

        {step === 5 && (
          <Step title="Looks good?" subtitle="Review and finish.">
            <ReviewSummary
              firstName={firstName}
              lastName={lastName}
              sports={sports}
              entries={entries}
            />
          </Step>
        )}

        <div className="mt-10 flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1 || busy}
          >
            Back
          </Button>
          {step < 5 ? (
            <Button onClick={handleContinue} disabled={!canContinue || busy}>
              {busy ? "Saving…" : "Continue"}
            </Button>
          ) : (
            <Button onClick={handleFinish} disabled={busy}>
              {busy ? "Finishing…" : "Finish setup"}
            </Button>
          )}
        </div>
      </div>
    </div>
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
      <div className="mt-8">{children}</div>
    </div>
  );
}

function ReviewSummary({
  firstName,
  lastName,
  sports,
  entries,
}: {
  firstName: string;
  lastName: string;
  sports: SportKey[];
  entries: LevelEntry[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-text-secondary">Coach</p>
        <p className="mt-1 text-lg font-semibold text-text-primary">
          {firstName} {lastName}
        </p>
      </div>
      {sports.map((sportKey) => {
        const sport = getSport(sportKey)!;
        const sportEntries = entries.filter((e) => e.sport === sportKey);
        return (
          <div key={sportKey}>
            <p className="text-xs uppercase tracking-wider text-text-secondary">
              {sport.label}
            </p>
            <ul className="mt-2 space-y-1">
              {sportEntries.map((e) => {
                const lvl = getSportLevel(sportKey, e.levelKey)!;
                return (
                  <li
                    key={e.levelKey}
                    className="flex justify-between border-b border-divider/60 py-1.5 text-sm"
                  >
                    <span className="text-text-primary">{lvl.label}</span>
                    <span className="text-text-secondary">
                      <span className="text-text-primary font-semibold">{e.hoursPerWeek}</span>{" "}
                      <span className="font-hand text-lg text-accent-ink">hrs / week</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
