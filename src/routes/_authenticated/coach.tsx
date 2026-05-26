import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { coachProfileQueryOptions } from "@/hooks/use-coach-profile";
import { getSport, getSportLevel, type SportKey } from "@/lib/coach-sports";

export const Route = createFileRoute("/_authenticated/coach")({
  loader: ({ context }) => context.queryClient.ensureQueryData(coachProfileQueryOptions),
  component: CoachHome,
});

function CoachHome() {
  const { data } = useSuspenseQuery(coachProfileQueryOptions);
  const navigate = useNavigate();

  // Gate: not onboarded → wizard
  useEffect(() => {
    if (!data.profile.onboardedAt) navigate({ to: "/onboarding" });
  }, [data.profile.onboardedAt, navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  const sports = Array.from(new Set(data.levels.map((l) => l.sport))) as SportKey[];
  const displayName =
    `${data.profile.firstName} ${data.profile.lastName}`.trim() || "Coach";

  if (!data.profile.onboardedAt) return null;

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 py-12">
      <div className="rounded-2xl bg-card p-8 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.15)] sm:p-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
              Coach
            </p>
            <h1 className="mt-2 text-4xl">
              Welcome back, <span className="pen-highlight">{displayName}</span>
            </h1>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/coach/settings">Settings</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>

        <div className="mt-10 space-y-8">
          {sports.map((sportKey) => {
            const sport = getSport(sportKey)!;
            const entries = data.levels.filter((l) => l.sport === sportKey);
            return (
              <div key={sportKey}>
                <h2 className="text-xl">{sport.label}</h2>
                <p className="mt-1 text-xs uppercase tracking-wider text-text-secondary">
                  {entries.length} {entries.length === 1 ? "level" : "levels"}
                </p>
                <ul className="mt-4 space-y-1.5">
                  {entries.map((e) => {
                    const lvl = getSportLevel(sportKey, e.levelKey);
                    return (
                      <li
                        key={e.levelKey}
                        className="flex justify-between border-b border-divider/60 py-1.5 text-sm"
                      >
                        <span className="text-text-primary">{lvl?.label ?? e.levelKey}</span>
                        <span className="font-hand text-text-secondary">
                          {e.hoursPerWeek} hrs / week
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <p className="mt-10 text-sm text-text-secondary">More coming in the next slice.</p>
      </div>
    </div>
  );
}
