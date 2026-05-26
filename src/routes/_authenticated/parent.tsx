import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/parent")({
  component: ParentHome,
});

function ParentHome() {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
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
        Welcome, parent.
      </h1>
      <p className="mt-3 text-text-secondary">
        Your athletes are linked to your coach. We&apos;ll build out your home
        screen in the next slice.
      </p>
    </div>
  );
}
