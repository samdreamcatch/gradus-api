import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SportChip } from "@/components/onboarding/sport-chip";
import { SPORTS, getSport, getSportLevel, type SportKey } from "@/lib/coach-sports";
import {
  coachProfileQueryOptions,
  useSaveCoachLevels,
  useSaveCoachProfile,
} from "@/hooks/use-coach-profile";

export const Route = createFileRoute("/_authenticated/coach/settings")({
  loader: ({ context }) => context.queryClient.ensureQueryData(coachProfileQueryOptions),
  component: SettingsPage,
});

type LevelEntry = { sport: string; levelKey: string; hoursPerWeek: number };

function SettingsPage() {
  const { data } = useSuspenseQuery(coachProfileQueryOptions);
  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
            Settings
          </p>
          <h1 className="mt-1 text-3xl sm:text-4xl">Your coach profile</h1>
        </div>
        <Button asChild variant="ghost">
          <Link to="/coach">Back</Link>
        </Button>
      </div>

      <div className="space-y-6">
        <NameSection firstName={data.profile.firstName} lastName={data.profile.lastName} />
        <LevelsSection levels={data.levels} />
        <PracticeSection levels={data.levels} />
      </div>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-card p-6 shadow-[0_6px_24px_-16px_rgba(0,0,0,0.2)] sm:p-8">
      <h2 className="text-xl">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function NameSection({ firstName: f0, lastName: l0 }: { firstName: string; lastName: string }) {
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
    <SectionCard title="Name">
      <div className="grid gap-4 sm:grid-cols-2">
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
      <div className="mt-4 flex justify-end">
        <Button
          onClick={handleSave}
          disabled={
            save.isPending ||
            firstName.trim().length === 0 ||
            lastName.trim().length === 0
          }
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </SectionCard>
  );
}

function LevelsSection({ levels }: { levels: LevelEntry[] }) {
  const initialSports = useMemo(
    () => Array.from(new Set(levels.map((l) => l.sport))) as SportKey[],
    [levels],
  );
  const [sports, setSports] = useState<SportKey[]>(initialSports);
  const [entries, setEntries] = useState<LevelEntry[]>(levels);
  const save = useSaveCoachLevels();

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
      return [...prev, { sport, levelKey, hoursPerWeek: 0 }];
    });
  };

  const handleSave = async () => {
    try {
      await save.mutateAsync({ entries });
      toast.success("Sports & levels saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  };

  const valid =
    sports.length > 0 && sports.every((s) => entries.some((e) => e.sport === s));

  return (
    <SectionCard title="Sports & levels">
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

      {sports.length > 0 && (
        <div className="mt-8 space-y-8">
          {sports.map((sportKey) => {
            const sport = getSport(sportKey)!;
            return (
              <div key={sportKey}>
                <h3 className="text-lg">{sport.label}</h3>
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
      )}

      <div className="mt-6 flex justify-end">
        <Button onClick={handleSave} disabled={save.isPending || !valid}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </SectionCard>
  );
}

function PracticeSection({ levels }: { levels: LevelEntry[] }) {
  const [entries, setEntries] = useState<LevelEntry[]>(levels);
  const save = useSaveCoachLevels();

  useEffect(() => setEntries(levels), [levels]);

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
      toast.success("Practice expectations saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  };

  const groupedSports = Array.from(new Set(entries.map((e) => e.sport))) as SportKey[];

  return (
    <SectionCard title="Practice expectations">
      {groupedSports.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Add sports and levels above first.
        </p>
      ) : (
        <div className="space-y-6">
          {groupedSports.map((sportKey) => {
            const sport = getSport(sportKey)!;
            const sportEntries = entries.filter((e) => e.sport === sportKey);
            return (
              <div key={sportKey}>
                <h3 className="text-lg">{sport.label}</h3>
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
      )}
      {groupedSports.length > 0 && (
        <div className="mt-6 flex justify-end">
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
