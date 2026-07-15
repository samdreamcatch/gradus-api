import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { requireRole } from "@/lib/role-guard";
import { coachProfileQueryOptions } from "@/hooks/use-coach-profile";
import { ConnectionCelebration } from "@/components/connection-celebration";

const ENTITLED = new Set(["paid", "promo_free", "club_covered"]);

export const Route = createFileRoute("/_authenticated/coach")({
  beforeLoad: async ({ context, location }) => {
    await requireRole("coach", context.queryClient);

    // Onboarding step & paywall itself are always reachable so the coach
    // can finish signup / see why access is blocked.
    const path = location.pathname;
    if (path.startsWith("/coach/onboarding") || path.startsWith("/coach/paywall")) {
      return;
    }

    try {
      const data = await context.queryClient.ensureQueryData(coachProfileQueryOptions);
      if (!data.profile.onboardedAt) {
        throw redirect({ to: "/coach/onboarding" });
      }
      if (!ENTITLED.has(data.profile.entitlement)) {
        throw redirect({ to: "/coach/paywall" });
      }
    } catch (err) {
      if (err && typeof err === "object" && "to" in err) throw err;
      // If the profile query fails for another reason, let downstream loaders handle it.
    }
  },
  component: () => (
    <>
      <Outlet />
      <ConnectionCelebration role="coach" />
    </>
  ),
});
