import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/coach")({
  component: CoachHome,
});

function CoachHome() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    user?.email ??
    "…";

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-xl rounded-2xl bg-card p-10 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.15)]">
        <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
          Coach
        </p>
        <h1 className="mt-2 text-4xl">
          Signed in as <span className="pen-highlight">{displayName}</span>
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          More coming in the next slice.
        </p>
        <div className="mt-8">
          <Button variant="outline" onClick={handleSignOut}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
