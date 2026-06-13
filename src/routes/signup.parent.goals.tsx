import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getSport, SPORTS } from "@/lib/coach-sports";
import { listAthletesForCode, saveAthleteGoals } from "@/lib/parent-signup.functions";

const searchSchema = z.object({
  code: z.string().trim().toUpperCase().length(8).regex(/^[A-Z2-9]+$/).optional(),
});

export const Route = createFileRoute("/signup/parent/goals")({
  validateSearch: (s) => searchSchema.parse(s),
  component: ParentGoalsPage,
});

type GoalsState = {
  sport: string;
  currentLevelKey: string;
  seasonGoalKey: string;
  longTermGoal: string;
};

function ParentGoalsPage() {
  const { code } = Route.useSearch();
  const navigate = useNavigate();
  const fetchAthletes = useServerFn(listAthletesForCode);
  const saveGoals = useServerFn(saveAthleteGoals);

  const { data, isLoading, error } = useQuery({
    queryKey: ["athletes-for-code", code ?? null],
    queryFn: () => fetchAthletes({ data: { code: code ?? null } }),
  });

  const [index, setIndex] = useState(0);
  const [byAthlete, setByAthlete] = useState<Record<string, GoalsState>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const athletes = data?.athletes ?? [];
  const sports = data?.sports ?? [];
  const current = athletes[index];

  const defaultSport = sports.length === 1 ? sports[0] : "";
  const state: GoalsState = byAthlete[current?.id ?? ""] ?? {
    sport: defaultSport,
    currentLevelKey: "",
    seasonGoalKey: "",
    longTermGoal: "",
  };

  const sportMeta = useMemo(() => getSport(state.sport), [state.sport]);

  const update = (patch: Partial<GoalsState>) => {
    if (!current) return;
    setByAthlete((prev) => ({
      ...prev,
      [current.id]: { ...state, ...patch },
    }));
  };

  const canContinue =
    !!state.sport && !!state.currentLevelKey && !!state.seasonGoalKey;

  const handleNext = async () => {
    if (!current) return;
    setFormError(null);
    setSaving(true);
    try {
      await saveGoals({
        data: {
          code: code ?? null,
          athleteId: current.id,
          sport: state.sport,
          currentLevelKey: state.currentLevelKey,
          seasonGoalKey: state.seasonGoalKey,
          longTermGoal: state.longTermGoal.trim(),
        },
      });
      if (index + 1 < athletes.length) {
        setIndex(index + 1);
      } else {
        navigate({ to: "/signup/parent/schedule", search: code ? { code } : {} });
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-xl rounded-2xl bg-card p-8 shadow-card sm:p-10">
        {isLoading ? (
          <p className="text-text-tertiary">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : !current ? (
          <p className="text-text-tertiary">No athletes found for this code.</p>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
                Athlete {index + 1} of {athletes.length}
              </p>
              <div className="flex gap-1.5">
                {athletes.map((_, n) => (
                  <span
                    key={n}
                    className={`h-1.5 w-6 rounded-full ${n <= index ? "bg-accent" : "bg-divider"}`}
                  />
                ))}
              </div>
            </div>

            <h1 className="font-display text-3xl text-text-primary sm:text-4xl">
              {current.firstName}&apos;s goals
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              Where {current.firstName} is now, and where you&apos;d like them to go.
            </p>

            <div className="mt-8 space-y-5">
              {sports.length > 1 && (
                <div className="space-y-2">
                  <Label>Sport with this coach</Label>
                  <Select
                    value={state.sport}
                    onValueChange={(v) =>
                      update({ sport: v, currentLevelKey: "", seasonGoalKey: "" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a sport" />
                    </SelectTrigger>
                    <SelectContent>
                      {sports.map((s) => (
                        <SelectItem key={s} value={s}>
                          {getSport(s)?.label ?? s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

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
                    {(sportMeta?.levels ?? SPORTS[0].levels).map((lvl) => (
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
                  Where you&apos;d like {current.firstName} to be by the end of the season.
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
                    {(sportMeta?.levels ?? SPORTS[0].levels).map((lvl) => (
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
                  The bigger picture — college team, junior tour, lifelong skill. Optional.
                </p>
                <Textarea
                  id="longTermGoal"
                  value={state.longTermGoal}
                  onChange={(e) => update({ longTermGoal: e.target.value })}
                  maxLength={2000}
                  rows={4}
                  placeholder="e.g. Play D1 college tennis"
                />
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>

            <div className="mt-10 flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0 || saving}
              >
                Back
              </Button>
              <Button onClick={handleNext} disabled={!canContinue || saving}>
                {saving
                  ? "Saving…"
                  : index + 1 < athletes.length
                    ? "Save & next athlete"
                    : "Continue"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
