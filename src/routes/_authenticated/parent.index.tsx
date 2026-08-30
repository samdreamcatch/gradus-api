import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { InviteCoachCard } from "@/components/parent/invite-coach-card";
import { getParentSignupStatus } from "@/lib/parent-signup.functions";

const parentSignupStatusQueryOptions = {
  queryKey: ["parent-signup-status"] as const,
  queryFn: () => getParentSignupStatus(),
};

export const Route = createFileRoute("/_authenticated/parent/")({
  loader: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(parentSignupStatusQueryOptions);
    if (!status.hasParentProfile) {
      throw redirect({ to: "/signup/parent" });
    }
    if (!status.hasAthletes) {
      throw redirect({
        to: "/signup/parent/athletes",
        search: status.inviteCode ? { code: status.inviteCode } : {},
      });
    }
    return null;
  },
  errorComponent: ({ error }) => {
    console.error("[ParentHome] loader error", error);
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm text-text-secondary">Couldn&apos;t load your account.</p>
          <p className="mt-2 text-xs text-text-tertiary">{error.message}</p>
        </div>
      </div>
    );
  },
  pendingComponent: () => (
    <div className="flex min-h-dvh items-center justify-center text-sm text-text-secondary">
      Loading…
    </div>
  ),
  component: ParentHome,
});

function ParentHome() {
  const fetchStatus = useServerFn(getParentSignupStatus);
  const { data: status } = useQuery({
    queryKey: ["parent-signup-status"],
    queryFn: () => fetchStatus(),
  });

  const showInviteCard = !!status?.hasParentProfile && status.hasAthletes && !status.hasAnyCoach;

  return (
    <div className="mx-auto max-w-2xl px-3 py-6 pb-app-chrome">
      {showInviteCard ? (
        <div className="mb-6">
          <InviteCoachCard />
        </div>
      ) : (
        <div className="mb-6 rounded-2xl bg-card p-6 shadow-card">
          <h1 className="text-h3 font-display">Welcome back</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Head to Plans or Messages from the bottom nav to see what your coach is working on with
            your athlete.
          </p>
        </div>
      )}
      <ParentBottomNav />
    </div>
  );
}
