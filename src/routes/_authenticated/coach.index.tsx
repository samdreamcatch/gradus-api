import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { coachProfileQueryOptions } from "@/hooks/use-coach-profile";
import { CoachBottomNav } from "@/components/coach/bottom-nav";

export const Route = createFileRoute("/_authenticated/coach/")({
  component: CoachHome,
});

function CoachHome() {
  const { data, isLoading } = useQuery(coachProfileQueryOptions);
  const navigate = useNavigate();

  // Gate: not onboarded → wizard
  useEffect(() => {
    if (data && !data.profile.onboardedAt) navigate({ to: "/coach/onboarding" });
  }, [data, navigate]);

  if (isLoading || !data) return null;
  if (!data.profile.onboardedAt) return null;

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-3xl px-4 pt-8 pb-24" />
      <CoachBottomNav />
    </>
  );
}
