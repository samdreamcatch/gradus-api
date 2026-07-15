import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Logo } from "@/components/logo";
import { SportChip } from "@/components/onboarding/sport-chip";
import { getSport, SPORTS } from "@/lib/coach-sports";
import {
  createSelfManagedAthlete,
  getAdultOnboardingStatus,
  linkAdultAthleteToCoach,
  listAdultAthleteCoaches,
  previewCoachForAdultAthlete,
  saveAdultAthleteGoals,
} from "@/lib/adult-athlete-signup.functions";
import {
  ScheduleEditor,
  emptySlot,
  toISODate,
  validateSlots,
  type Slot,
} from "@/components/parent/schedule-editor";
import { saveAdultAthleteScheduleForCoach } from "@/lib/adult-athlete-schedule.functions";
import { PromoCodeField } from "@/components/signup/promo-code-field";
import { savePendingPromoCode } from "@/lib/pending-promo-code";


export const Route = createFileRoute("/_authenticated/athlete/onboarding")({
  component: AdultAthleteOnboardingPage,
});

/**
 * Post-signup onboarding for adult (self-managed) athletes:
 *   1. Optional: enter a coach's 8-char invite code + pick sports → link.
 *   2. Set current level + season goal + long-term goal per selected sport.
 *   3. If linked to any coaches, set lesson schedule per coach.
 */
function AdultAthleteOnboardingPage() {
  const navigate = useNavigate();
  const statusFn = useServerFn(getAdultOnboardingStatus);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["adult-onboarding-status"],
    queryFn: () => statusFn(),
  });

  const [step, setStep] = useState<"profile" | "coach" | "goals" | "schedule">(
    "profile",
  );
  const [sportsToGoal, setSportsToGoal] = useState<string[]>([]);

  // Once the athlete row exists, jump past the profile step.
  useEffect(() => {
    if (status?.hasAthlete && status.selfManaged && step === "profile") {
      setStep("coach");
    }
  }, [status?.hasAthlete, status?.selfManaged, step]);

  if (statusLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4 py-12">
        <p className="text-sm text-text-secondary">Loading…</p>
      </div>
    );
  }

  // A parent-managed athlete row exists — this flow is for self-managed only.
  if (status?.hasAthlete && !status.selfManaged) {
    navigate({ to: "/athlete/plans" });
    return null;
  }

  const finish = () => navigate({ to: "/athlete/plans" });

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <div className="mb-8 text-center">
          <Logo className="text-5xl" />
        </div>

        {step === "profile" ? (
          <ProfileStep onDone={() => setStep("coach")} />
        ) : step === "coach" ? (
          <CoachStep
            onDone={(sports) => {
              setSportsToGoal(sports);
              setStep("goals");
            }}
          />
        ) : step === "goals" ? (
          <GoalsStep
            initialSports={sportsToGoal}
            onDone={() => setStep("schedule")}
          />
        ) : (
          <ScheduleStep onDone={finish} />
        )}
      </div>
    </div>
  );
}

function ProfileStep({ onDone }: { onDone: () => void }) {
  const createAthlete = useServerFn(createSelfManagedAthlete);
  const qc = useQueryClient();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Client-side age check; DB trigger enforce_adult_self_managed is the
  // authoritative gate.
  const birthdateValid = (() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return false;
    const [y, m, d] = birthdate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const now = new Date();
    let age = now.getFullYear() - y;
    if (now.getMonth() < m - 1 || (now.getMonth() === m - 1 && now.getDate() < d)) {
      age -= 1;
    }
    return dt.getFullYear() === y && age >= 18 && age < 120;
  })();

  const namesValid = firstName.trim().length > 0 && lastName.trim().length > 0;
  const canSubmit = !saving && namesValid && birthdateValid;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createAthlete({
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          birthdate,
        },
      });
      await qc.invalidateQueries({ queryKey: ["adult-onboarding-status"] });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mb-6 text-center">
        <p className="font-display text-2xl text-text-primary">
          Tell us about yourself
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          Your coach will see your name on your lessons.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              name="given-name"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              maxLength={60}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              name="family-name"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              maxLength={60}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="birthdate">Date of birth</Label>
          <Input
            id="birthdate"
            name="bday"
            type="date"
            autoComplete="bday"
            value={birthdate}
            onChange={(e) => setBirthdate(e.target.value)}
            required
            max={new Date().toISOString().slice(0, 10)}
          />
          <p className="text-xs text-text-tertiary">
            You must be 18 or older to have your own account.
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {saving ? "Saving…" : "Continue"}
        </Button>
      </form>
    </>
  );
}

function ScheduleStep({ onDone }: { onDone: () => void }) {
  const listCoaches = useServerFn(listAdultAthleteCoaches);
  const saveFn = useServerFn(saveAdultAthleteScheduleForCoach);

  const { data, isLoading } = useQuery({
    queryKey: ["adult-athlete-coaches"],
    queryFn: () => listCoaches(),
  });

  const coaches = data?.coaches ?? [];
  const [index, setIndex] = useState(0);
  const [byCoach, setByCoach] = useState<Record<string, Slot[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return <p className="text-sm text-text-secondary">Loading…</p>;
  }
  if (coaches.length === 0) {
    onDone();
    return null;
  }

  const current = coaches[index];
  const slots = byCoach[current.coachId] ?? [emptySlot()];
  const setSlots = (next: Slot[]) =>
    setByCoach((p) => ({ ...p, [current.coachId]: next }));

  const finish = async (skip: boolean) => {
    setError(null);
    let cleaned: Array<{
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
      frequency: Slot["frequency"];
      weeksOfMonth: number[];
      startsOn: string | null;
    }> = [];
    if (!skip) {
      const filtered = slots.filter(
        (s): s is Slot & { dayOfWeek: number; startMinute: number; endMinute: number } =>
          s.dayOfWeek !== null && s.startMinute !== null && s.endMinute !== null,
      );
      const err = filtered.length ? validateSlots(filtered) : null;
      if (err) {
        setError(err);
        return;
      }
      cleaned = filtered.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        frequency: s.frequency,
        weeksOfMonth:
          s.frequency === "weekly" || s.frequency === "biweekly"
            ? []
            : [...s.weeksOfMonth].sort((a, b) => a - b),
        startsOn:
          s.frequency === "biweekly" && s.startsOn ? toISODate(s.startsOn) : null,
      }));
    }
    setSaving(true);
    try {
      await saveFn({ data: { coachId: current.coachId, slots: cleaned } });
      if (index + 1 < coaches.length) {
        setIndex(index + 1);
      } else {
        onDone();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
          Coach {index + 1} of {coaches.length}
        </p>
        <div className="flex gap-1.5">
          {coaches.map((_, n) => (
            <span
              key={n}
              className={`h-1.5 w-6 rounded-full ${n <= index ? "bg-accent" : "bg-divider"}`}
            />
          ))}
        </div>
      </div>

      <h1 className="font-display text-3xl text-text-primary">
        Your lessons with {current.coachName}
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        When do you see this coach each week? We&apos;ll use it to recommend a
        practice schedule around lessons.
      </p>

      <div className="mt-6">
        <ScheduleEditor slots={slots} onChange={setSlots} />
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-8 flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => finish(true)} disabled={saving}>
          Skip
        </Button>
        <Button onClick={() => finish(false)} disabled={saving}>
          {saving
            ? "Saving…"
            : index + 1 < coaches.length
              ? "Save & next"
              : "Finish"}
        </Button>
      </div>
    </>
  );
}



function CoachStep({ onDone }: { onDone: (sports: string[]) => void }) {
  const previewFn = useServerFn(previewCoachForAdultAthlete);
  const linkFn = useServerFn(linkAdultAthleteToCoach);

  const [code, setCode] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [preview, setPreview] = useState<
    { coachId: string; coachName: string; sports: string[] } | null
  >(null);
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const stashPromoIfAny = () => {
    if (promoCode.trim()) savePendingPromoCode(promoCode);
  };

  const previewMut = useMutation({
    mutationFn: async (c: string) => previewFn({ data: { code: c } }),
    onSuccess: (data) => {
      setPreview(data);
      setSelectedSports(data.sports.length === 1 ? [...data.sports] : []);
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Something went wrong"),
  });

  // If we stashed a coach invite code from /i/CODE before signup, prefill it
  // and auto-run the preview so the athlete lands on the sport-selection step.
  useEffect(() => {
    let pending: string | null = null;
    try {
      pending = localStorage.getItem("gradus.pendingCoachInvite");
    } catch {
      pending = null;
    }
    if (!pending) return;
    setCode(pending);
    previewMut.mutate(pending);
    try {
      localStorage.removeItem("gradus.pendingCoachInvite");
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const linkMut = useMutation({
    mutationFn: async () =>
      linkFn({ data: { code: code.trim().toUpperCase(), sports: selectedSports } }),
    onSuccess: () => {
      stashPromoIfAny();
      onDone(selectedSports);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Something went wrong"),
  });

  const handleSkip = () => {
    stashPromoIfAny();
    onDone([]);
  };

  const codeValid = /^[A-Z2-9]{8}$/.test(code.trim().toUpperCase());

  return (
    <>
      <div className="mb-6 text-center">
        <p className="font-display text-2xl text-text-primary">
          Connect with a coach
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          Have a coach&apos;s invite code? Enter it now — or skip and add one later
          from settings.
        </p>
      </div>

      {!preview ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            previewMut.mutate(code.trim().toUpperCase());
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="code" className="sr-only">Coach invite code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              minLength={8}
              placeholder="––––––––"
              className="text-center font-mono text-2xl tracking-[0.4em] uppercase h-14"
              autoComplete="off"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit"
            className="w-full"
            disabled={!codeValid || previewMut.isPending}
          >
            {previewMut.isPending ? "Looking up…" : "Look up coach"}
          </Button>

          <div className="pt-2">
            <PromoCodeField value={promoCode} onChange={setPromoCode} />
          </div>

          <Button type="button" variant="ghost" className="w-full" onClick={handleSkip}>
            Skip for now
          </Button>
        </form>
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-divider bg-elevated p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-text-tertiary">
              Coach
            </p>
            <p className="mt-2 font-display text-2xl text-text-primary">
              {preview.coachName}
            </p>
          </div>

          <div>
            <p className="mb-3 text-sm font-semibold text-text-primary">
              Which sports are you working on with this coach?
            </p>
            <div className="flex flex-wrap gap-2">
              {preview.sports.map((s) => {
                const checked = selectedSports.includes(s);
                return (
                  <SportChip
                    key={s}
                    selected={checked}
                    onClick={() =>
                      setSelectedSports((prev) =>
                        checked ? prev.filter((x) => x !== s) : [...prev, s],
                      )
                    }
                  >
                    {getSport(s)?.label ?? s}
                  </SportChip>
                );
              })}
            </div>
            {preview.sports.length === 0 && (
              <p className="text-sm text-text-secondary">
                This coach hasn&apos;t set up their sports yet. Ask them to finish
                their profile, then try again.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-3">
            <Button
              className="w-full"
              disabled={selectedSports.length === 0 || linkMut.isPending}
              onClick={() => linkMut.mutate()}
            >
              {linkMut.isPending ? "Linking…" : "Connect with coach"}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setPreview(null);
                setSelectedSports([]);
                setError(null);
              }}
            >
              Try a different code
            </Button>
            <Button variant="ghost" className="w-full" onClick={handleSkip}>
              Skip for now
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

type GoalDraft = {
  currentLevelKey: string;
  seasonGoalKey: string;
  longTermGoal: string;
};

function GoalsStep({
  initialSports,
  onDone,
}: {
  initialSports: string[];
  onDone: () => void;
}) {
  const saveGoals = useServerFn(saveAdultAthleteGoals);

  // If the coach step gave us sports, use them; otherwise let the athlete
  // pick from the full catalog.
  const [sports, setSports] = useState<string[]>(initialSports);
  const [picking, setPicking] = useState(initialSports.length === 0);
  const [index, setIndex] = useState(0);
  const [byS, setByS] = useState<Record<string, GoalDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const current = sports[index];
  const state: GoalDraft = byS[current ?? ""] ?? {
    currentLevelKey: "",
    seasonGoalKey: "",
    longTermGoal: "",
  };
  const sportMeta = useMemo(() => (current ? getSport(current) : undefined), [current]);

  const update = (patch: Partial<GoalDraft>) => {
    if (!current) return;
    setByS((prev) => ({ ...prev, [current]: { ...state, ...patch } }));
  };

  const canContinue =
    !!current && !!state.currentLevelKey && !!state.seasonGoalKey;

  const handleNext = async () => {
    if (!current) return;
    setError(null);
    setSaving(true);
    try {
      await saveGoals({
        data: {
          sport: current,
          currentLevelKey: state.currentLevelKey,
          seasonGoalKey: state.seasonGoalKey,
          longTermGoal: state.longTermGoal.trim(),
        },
      });
      if (index + 1 < sports.length) {
        setIndex(index + 1);
      } else {
        onDone();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  if (picking) {
    return (
      <>
        <div className="mb-6 text-center">
          <p className="font-display text-2xl text-text-primary">Your sports</p>
          <p className="mt-2 text-sm text-text-secondary">
            Pick the sports you want to track. You can set goals for each next.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {SPORTS.map((s) => {
            const checked = sports.includes(s.key);
            return (
              <SportChip
                key={s.key}
                selected={checked}
                onClick={() =>
                  setSports((prev) =>
                    checked ? prev.filter((x) => x !== s.key) : [...prev, s.key],
                  )
                }
              >
                {s.label}
              </SportChip>
            );
          })}
        </div>
        <div className="mt-8 space-y-3">
          <Button
            className="w-full"
            disabled={sports.length === 0}
            onClick={() => setPicking(false)}
          >
            Continue
          </Button>
          <Button variant="ghost" className="w-full" onClick={onDone}>
            Skip for now
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
          Sport {index + 1} of {sports.length}
        </p>
        <div className="flex gap-1.5">
          {sports.map((_, n) => (
            <span
              key={n}
              className={`h-1.5 w-6 rounded-full ${n <= index ? "bg-accent" : "bg-divider"}`}
            />
          ))}
        </div>
      </div>

      <h1 className="font-display text-3xl text-text-primary">
        Your {sportMeta?.label ?? current} goals
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        Where you are now, and where you&apos;d like to go.
      </p>

      <div className="mt-6 space-y-5">
        <div className="space-y-2">
          <Label>Current level</Label>
          {sportMeta && (
            <p className="text-xs uppercase tracking-wider text-text-tertiary">
              {sportMeta.standard}
            </p>
          )}
          <Select
            value={state.currentLevelKey}
            onValueChange={(v) => update({ currentLevelKey: v })}
            disabled={!sportMeta}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a level" />
            </SelectTrigger>
            <SelectContent>
              {(sportMeta?.levels ?? []).map((lvl) => (
                <SelectItem key={lvl.key} value={lvl.key}>
                  {lvl.label}
                  {lvl.hint ? ` — ${lvl.hint}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Season goal</Label>
          <p className="text-xs text-text-tertiary">
            Where you&apos;d like to be by the end of the season.
          </p>
          <Select
            value={state.seasonGoalKey}
            onValueChange={(v) => update({ seasonGoalKey: v })}
            disabled={!sportMeta}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a target level" />
            </SelectTrigger>
            <SelectContent>
              {(sportMeta?.levels ?? []).map((lvl) => (
                <SelectItem key={lvl.key} value={lvl.key}>
                  {lvl.label}
                  {lvl.hint ? ` — ${lvl.hint}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="longTermGoal">Long-term goal</Label>
          <p className="text-xs text-text-tertiary">
            The bigger picture — a race, a level, a lifelong skill. Optional.
          </p>
          <Textarea
            id="longTermGoal"
            value={state.longTermGoal}
            onChange={(e) => update({ longTermGoal: e.target.value })}
            maxLength={2000}
            rows={4}
            placeholder="e.g. Break 20 minutes in a 5K"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="mt-8 flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Skip
        </Button>
        <Button onClick={handleNext} disabled={!canContinue || saving}>
          {saving
            ? "Saving…"
            : index + 1 < sports.length
              ? "Save & next"
              : "Finish"}
        </Button>
      </div>
    </>
  );
}
