import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { coachProfileQueryOptions } from "@/hooks/use-coach-profile";
import { clearOrganizationLink } from "@/lib/coach-org.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/coach/paywall")({
  component: PaywallPage,
});

function PaywallPage() {
  const { data } = useQuery(coachProfileQueryOptions);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clearOrg = useServerFn(clearOrganizationLink);

  const entitlement = data?.profile.entitlement ?? "pending";

  // If they've been upgraded elsewhere (webhook, admin), bounce them into the app.
  if (
    entitlement === "paid" ||
    entitlement === "promo_free" ||
    entitlement === "club_covered"
  ) {
    navigate({ to: "/coach/roster", replace: true });
    return null;
  }

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-4 py-10">
      <div className="w-full rounded-2xl bg-card p-8 shadow-card">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
          <Sparkles className="h-6 w-6" />
        </div>
        <h1 className="font-display text-h2 text-text-primary">
          One last step to unlock Gradus
        </h1>
        <p className="mt-3 text-sm text-text-secondary">
          Subscribe to activate your coach workspace, publish plans, and message
          athletes and parents.
        </p>

        <div className="mt-8 space-y-3">
          <Button
            type="button"
            className="w-full"
            disabled
            title="Payments coming online this week"
          >
            Continue to payment
            <span className="ml-2 rounded-full bg-accent-foreground/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest">
              Coming soon
            </span>
          </Button>
          <p className="text-center text-xs text-text-tertiary">
            Checkout goes live shortly. In the meantime, if you're joining
            through a club, add your code below.
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-divider bg-elevated p-4">
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
            <div className="text-sm">
              <p className="font-semibold text-text-primary">
                Joining through a club?
              </p>
              <p className="mt-1 text-text-secondary">
                If your academy or association is a Gradus partner, they can
                cover your subscription.
              </p>
              <Link
                to="/coach/settings"
                className="mt-2 inline-block text-accent-ink underline underline-offset-2"
              >
                Enter club code in Settings →
              </Link>
            </div>
          </div>
        </div>

        {data?.profile.organizationId && (
          <div className="mt-4 text-center">
            <button
              type="button"
              className="text-xs text-text-tertiary underline underline-offset-2"
              onClick={async () => {
                try {
                  await clearOrg();
                  await qc.invalidateQueries({ queryKey: ["coach-profile"] });
                  toast.success("Club link removed");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Couldn't unlink");
                }
              }}
            >
              Unlink from current club
            </button>
          </div>
        )}

        <div className="mt-8 border-t border-divider pt-4 text-center">
          <button
            type="button"
            onClick={handleSignOut}
            className="text-xs text-text-tertiary underline underline-offset-2"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
