import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AthleteBottomNav } from "@/components/athlete/bottom-nav";
import { getMyAthlete } from "@/lib/athlete-signup.functions";

export const Route = createFileRoute("/_authenticated/athlete/")({
  component: AthleteHome,
});

function AthleteHome() {
  // navigate kept available for future routing hooks
  void useNavigate;
  const fetchMe = useServerFn(getMyAthlete);
  const { data, isLoading } = useQuery({
    queryKey: ["my-athlete"],
    queryFn: () => fetchMe(),
  });

  if (isLoading) return null;

  const displayName = data?.firstName?.trim() || "Athlete";

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-3 py-6 pb-24">
      <div className="rounded-2xl bg-card p-8 shadow-card sm:p-10">
        <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
          Welcome
        </p>
        <h1 className="mt-3 font-display text-4xl text-text-primary">
          Hey, {displayName}.
        </h1>
        <p className="mt-4 font-hand text-2xl text-accent-ink">
          Your training home is on its way.
        </p>
        <p className="mt-4 text-sm text-text-secondary">
          Head to <span className="pen-highlight">Plans</span> to see what your
          coach has put together, or open{" "}
          <span className="pen-highlight">Settings</span> to manage your
          account.
        </p>
      </div>

      <AthleteBottomNav />
    </div>
  );
}
