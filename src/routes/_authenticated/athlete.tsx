import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/athlete")({
  component: AthleteHome,
});

function AthleteHome() {
  const navigate = useNavigate();
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login/athlete" });
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="flex items-center justify-between">
        <Logo className="text-4xl" />
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
      <h1 className="mt-6 font-display text-3xl text-text-primary">
        Welcome, athlete.
      </h1>
      <p className="mt-3 text-text-secondary">
        You&apos;re linked up with your coach. Your home screen lands in the
        next slice.
      </p>
    </div>
  );
}
