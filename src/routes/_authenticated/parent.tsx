import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getParentSignupStatus } from "@/lib/parent-signup.functions";
import { InviteCoachBanner } from "@/components/parent/invite-coach-banner";

export const Route = createFileRoute("/_authenticated/parent")({
  component: ParentLayout,
});

function ParentLayout() {
  const fetchStatus = useServerFn(getParentSignupStatus);
  const { data: status } = useQuery({
    queryKey: ["parent-signup-status"],
    queryFn: () => fetchStatus(),
  });
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Hide on signup flows (those live under /signup/parent, not /parent) and
  // while the parent has no athletes yet — the signup wizard handles that.
  const showBanner =
    !!status?.hasParentProfile &&
    status.hasAthletes &&
    !status.hasAnyCoach &&
    !pathname.startsWith("/parent/settings"); // settings page hosts the full card

  return (
    <>
      {showBanner && <InviteCoachBanner />}
      <Outlet />
    </>
  );
}
