import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { InviteCoachCard } from "@/components/parent/invite-coach-card";
import { getParentSignupStatus } from "@/lib/parent-signup.functions";
import { listMyPendingGuardianClaims } from "@/lib/guardian.functions";

const parentSignupStatusQueryOptions = {
  queryKey: ["parent-signup-status"] as const,
  queryFn: () => getParentSignupStatus(),
};

const pendingClaimsQueryOptions = {
  queryKey: ["guardian-pending-claims"] as const,
  queryFn: () => listMyPendingGuardianClaims(),
};

export const Route = createFileRoute("/_authenticated/parent/")({
  loader: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(parentSignupStatusQueryOptions);
    if (!status.hasParentProfile) {
      throw redirect({ to: "/signup/parent" });
    }
    if (!status.hasAthletes) {
      // A parent with no athlete yet whom a coach just listed sees that first.
      const pending = await context.queryClient.ensureQueryData(pendingClaimsQueryOptions);
      if (pending.claims.length > 0) return null;
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
          <p className="mt-2 text-xs text-text-tertiary">
            {error instanceof Error ? error.message : String(error)}
          </p>
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

  // A coach added an athlete with this parent's email (beta feedback
  // 2026-10-07): nothing links until the parent confirms on /g/<token>.
  const fetchPending = useServerFn(listMyPendingGuardianClaims);
  const { data: pending } = useQuery({
    queryKey: ["guardian-pending-claims"],
    queryFn: () => fetchPending(),
  });

  return (
    <div className="mx-auto max-w-2xl px-3 py-6 pb-app-chrome">
      {pending?.claims.map((claim) => (
        <div
          key={claim.token}
          className="mb-4 rounded-2xl border border-accent bg-card p-5 shadow-card"
        >
          <h2 className="font-display text-h4 text-text-primary">
            {claim.coachName ? `Coach ${claim.coachName}` : "A coach"} added{" "}
            {claim.athleteFirstName}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            They listed you as {claim.athleteFirstName}'s parent or guardian. Is this your child?
            Nothing is linked until you confirm.
          </p>
          <Link
            to="/g/$token"
            params={{ token: claim.token }}
            aria-label={`Review and confirm ${claim.athleteFirstName}`}
            className="press mt-3 inline-flex rounded-pill bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
          >
            Review and confirm
          </Link>
        </div>
      ))}
      {status && !status.hasAthletes ? (
        <p className="mb-6 text-sm text-text-secondary">
          Not your child?{" "}
          <Link to="/signup/parent/athletes" className="font-semibold text-accent-ink underline">
            Add your athlete
          </Link>
          .
        </p>
      ) : showInviteCard ? (
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
