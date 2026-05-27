import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getCoachByInviteCode,
  linkAthletesToCoach,
} from "@/lib/parent-signup.functions";

const searchSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .length(8)
    .regex(/^[A-Z2-9]+$/)
    .optional(),
});

export const Route = createFileRoute("/signup/parent/athletes")({
  validateSearch: (s) => searchSchema.parse(s),
  component: ParentAthletesPage,
});

function ParentAthletesPage() {
  const { code } = Route.useSearch();
  const navigate = useNavigate();
  const fetchCoach = useServerFn(getCoachByInviteCode);
  const linkAthletes = useServerFn(linkAthletesToCoach);

  const { data: coach, isLoading, error: coachError } = useQuery({
    queryKey: ["coach-by-code", code],
    queryFn: () => fetchCoach({ data: { code: code! } }),
    enabled: !!code,
  });

  const [athletes, setAthletes] = useState<
    { firstName: string; lastName: string; birthdate: string }[]
  >([{ firstName: "", lastName: "", birthdate: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const updateAthlete = (
    i: number,
    field: "firstName" | "lastName" | "birthdate",
    v: string,
  ) => {
    setAthletes((arr) => arr.map((a, idx) => (idx === i ? { ...a, [field]: v } : a)));
  };
  const addAthlete = () =>
    setAthletes((arr) => [...arr, { firstName: "", lastName: "", birthdate: "" }]);
  const removeAthlete = (i: number) =>
    setAthletes((arr) => (arr.length === 1 ? arr : arr.filter((_, idx) => idx !== i)));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleaned = athletes
      .map((a) => ({
        firstName: a.firstName.trim(),
        lastName: a.lastName.trim(),
        birthdate: a.birthdate,
      }))
      .filter((a) => a.firstName && a.lastName && a.birthdate);
    if (cleaned.length === 0) {
      setError("Add at least one athlete with name and birthdate.");
      return;
    }

    setSubmitting(true);
    try {
      await linkAthletes({ data: { code, athletes: cleaned } });
      navigate({ to: "/signup/parent/goals", search: { code } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };


  const coachName = coach ? `${coach.firstName} ${coach.lastName}`.trim() : null;

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <div className="mb-6 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
            You&apos;re connecting to
          </p>
          {isLoading ? (
            <p className="mt-2 text-text-tertiary">Loading coach…</p>
          ) : coachError ? (
            <p className="mt-2 text-sm text-destructive">
              {(coachError as Error).message}
            </p>
          ) : (
            <>
              <h1 className="mt-2 font-display text-3xl text-text-primary">
                Coach {coachName}
              </h1>
              {coach && coach.sports.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {coach.sports.map((s) => (
                    <span
                      key={s}
                      className="rounded-pill border border-divider bg-elevated px-3 py-1 text-xs font-semibold uppercase tracking-wide text-text-secondary"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label>
              Which of your athletes train{athletes.length > 1 ? "" : "s"} with
              {coachName ? ` Coach ${coachName}` : " this coach"}?
            </Label>
            <p className="text-xs text-text-tertiary">
              Add only the athletes connected to this coach. You can link other
              coaches later.
            </p>
            <div className="space-y-3 pt-1">
              {athletes.map((a, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={a.firstName}
                        onChange={(e) => updateAthlete(i, "firstName", e.target.value)}
                        maxLength={80}
                        required={i === 0}
                        aria-label={`Athlete ${i + 1} first name`}
                        placeholder="First name"
                      />
                      <Input
                        value={a.lastName}
                        onChange={(e) => updateAthlete(i, "lastName", e.target.value)}
                        maxLength={80}
                        required={i === 0}
                        aria-label={`Athlete ${i + 1} last name`}
                        placeholder="Last name"
                      />
                    </div>
                    <Input
                      type="date"
                      value={a.birthdate}
                      onChange={(e) => updateAthlete(i, "birthdate", e.target.value)}
                      required={i === 0}
                      max={new Date().toISOString().slice(0, 10)}
                      aria-label={`Athlete ${i + 1} birthdate`}
                      placeholder="Birthdate"
                    />
                  </div>
                  {athletes.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAthlete(i)}
                      aria-label={`Remove athlete ${i + 1}`}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}

            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addAthlete}
              className="text-accent-ink"
            >
              <Plus className="size-4" /> Add another athlete
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={submitting || !coach}>
            {submitting ? "Saving..." : "Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
