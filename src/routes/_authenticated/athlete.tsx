import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { getMyAthlete } from "@/lib/athlete-signup.functions";

export const Route = createFileRoute("/_authenticated/athlete")({
  component: AthleteHome,
});

function AthleteHome() {
  const navigate = useNavigate();
  const fetchMe = useServerFn(getMyAthlete);
  const { data, isLoading } = useQuery({
    queryKey: ["my-athlete"],
    queryFn: () => fetchMe(),
  });

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  if (isLoading) return null;

  const displayName = data?.firstName?.trim() || "Athlete";

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 py-12">
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
          You&apos;re all set up. We&apos;ll let you know as soon as the athlete
          experience is ready.
        </p>

        <div className="mt-10">
          <Button variant="outline" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
