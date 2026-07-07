import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { SportChip } from "@/components/onboarding/sport-chip";
import {
  getAdultOnboardingStatus,
  linkAdultAthleteToCoach,
  previewCoachForAdultAthlete,
} from "@/lib/adult-athlete-signup.functions";

export const Route = createFileRoute("/_authenticated/athlete/onboarding")({
  component: AdultAthleteOnboardingPage,
});

/**
 * Post-signup onboarding for adult (self-managed) athletes. Two-step:
 *   1. Optional: enter a coach's 8-char invite code + pick sports → link.
 *   2. Continue to the app.
 *
 * Minor athletes onboard through the parent flow and never see this page;
 * we guard by checking `selfManaged` on the athlete row and redirecting
 * everyone else to their normal home.
 */
function AdultAthleteOnboardingPage() {
  const navigate = useNavigate();
  const statusFn = useServerFn(getAdultOnboardingStatus);
  const previewFn = useServerFn(previewCoachForAdultAthlete);
  const linkFn = useServerFn(linkAdultAthleteToCoach);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["adult-onboarding-status"],
    queryFn: () => statusFn(),
  });

  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<
    { coachId: string; coachName: string; sports: string[] } | null
  >(null);
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const previewMut = useMutation({
    mutationFn: async (c: string) => previewFn({ data: { code: c } }),
    onSuccess: (data) => {
      setPreview(data);
      setSelectedSports(data.sports.length === 1 ? [...data.sports] : []);
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Something went wrong"),
  });

  const linkMut = useMutation({
    mutationFn: async () =>
      linkFn({ data: { code: code.trim().toUpperCase(), sports: selectedSports } }),
    onSuccess: () => navigate({ to: "/athlete/plans" }),
    onError: (e) => setError(e instanceof Error ? e.message : "Something went wrong"),
  });

  if (statusLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4 py-12">
        <p className="text-sm text-text-secondary">Loading…</p>
      </div>
    );
  }

  // Parent-managed athletes shouldn't be here; send them to the normal home.
  if (status && !status.selfManaged) {
    navigate({ to: "/athlete/plans" });
    return null;
  }

  const codeValid = /^[A-Z2-9]{8}$/.test(code.trim().toUpperCase());

  const skip = () => navigate({ to: "/athlete/plans" });

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <div className="mb-8 text-center">
          <Logo className="text-5xl" />
          <p className="mt-6 font-display text-2xl text-text-primary">
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
            <Button type="button" variant="ghost" className="w-full" onClick={skip}>
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
                      {s}
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
              <Button variant="ghost" className="w-full" onClick={skip}>
                Skip for now
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
