import { createFileRoute, redirect } from "@tanstack/react-router";
import { coachProfileQueryOptions } from "@/hooks/use-coach-profile";

export const Route = createFileRoute("/_authenticated/coach/")({
  loader: async ({ context }) => {
    const data = await context.queryClient.ensureQueryData(coachProfileQueryOptions);
    if (!data.profile.onboardedAt) {
      throw redirect({ to: "/coach/onboarding" });
    }
    throw redirect({ to: "/coach/roster" });
  },
  errorComponent: ({ error }) => {
    console.error("[CoachHome] loader error", error);
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm text-text-secondary">Couldn&apos;t load your coach profile.</p>
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
  component: () => null,
});
