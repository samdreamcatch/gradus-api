import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { coachProfileQueryOptions } from "@/hooks/use-coach-profile";
import { getSport, getSportLevel, type SportKey } from "@/lib/coach-sports";
import { CoachBottomNav } from "@/components/coach/bottom-nav";

export const Route = createFileRoute("/_authenticated/coach/")({
  component: CoachHome,
});

function CoachHome() {
  const { data, isLoading } = useQuery(coachProfileQueryOptions);
  const navigate = useNavigate();

  // Gate: not onboarded → wizard
  useEffect(() => {
    if (data && !data.profile.onboardedAt) navigate({ to: "/coach/onboarding" });
  }, [data, navigate]);

  if (isLoading || !data) return null;
  if (!data.profile.onboardedAt) return null;

  const sports = Array.from(new Set(data.levels.map((l) => l.sport))) as SportKey[];
  const displayName = data.profile.firstName.trim() || "Coach";

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-3xl px-4 pt-8 pb-24">
        <div className="rounded-2xl bg-card p-8 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.15)] sm:p-10">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
            Coach
          </p>
          <h1 className="mt-2 text-4xl">
            Welcome back, <span className="pen-highlight">{displayName}</span>
          </h1>
          <p className="mt-4 text-text-secondary">
            Open <span className="pen-highlight">Plans</span> to design today's
            session, <span className="pen-highlight">Messages</span> to talk
            with parents and athletes, or{" "}
            <span className="pen-highlight">Settings</span> to manage your
            roster, sports, and invite codes.
          </p>

          <div className="mt-8 space-y-8">
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
                          <span className="text-text-primary">
                            {lvl?.label ?? e.levelKey}
                          </span>
                          <span className="text-text-secondary">
                            <span className="text-text-primary font-semibold">
                              {e.hoursPerWeek}
                            </span>{" "}
                            <span className="font-hand text-lg text-accent-ink">
                              hrs / week
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <CoachBottomNav />
    </>
  );
}
