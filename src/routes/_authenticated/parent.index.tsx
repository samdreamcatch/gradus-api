import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { InviteCoachCard } from "@/components/parent/invite-coach-card";
import { getParentSignupStatus } from "@/lib/parent-signup.functions";

export const Route = createFileRoute("/_authenticated/parent/")({
  component: ParentHome,
});

function ParentHome() {
  const navigate = useNavigate();
  const fetchStatus = useServerFn(getParentSignupStatus);

  const { data: status } = useQuery({
    queryKey: ["parent-signup-status"],
    queryFn: () => fetchStatus(),
  });

  useEffect(() => {
    if (!status) return;
    if (!status.hasParentProfile) {
      navigate({ to: "/signup/parent" });
      return;
    }
    if (status.hasAthletes) return;
    // Profile exists but no athletes yet — resume wizard, with or without code
    navigate({
      to: "/signup/parent/athletes",
      search: status.inviteCode ? { code: status.inviteCode } : {},
    });
  }, [status, navigate]);

  // Show invite-coach card when the parent has athletes but no linked coach.
  const showInviteCard = !!status?.hasParentProfile && status.hasAthletes && !status.hasAnyCoach;

  return (
    <div className="mx-auto max-w-2xl px-3 py-6 pb-24">
      {showInviteCard && (
        <div className="mb-6">
          <InviteCoachCard />
        </div>
      )}
      <ParentBottomNav />
    </div>
  );
}
