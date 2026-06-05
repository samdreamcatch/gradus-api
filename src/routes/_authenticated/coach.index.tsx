import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { coachProfileQueryOptions } from "@/hooks/use-coach-profile";

export const Route = createFileRoute("/_authenticated/coach/")({
  component: CoachHome,
});

function CoachHome() {
  const { data } = useQuery(coachProfileQueryOptions);
  const navigate = useNavigate();

  useEffect(() => {
    if (!data) return;
    if (!data.profile.onboardedAt) navigate({ to: "/coach/onboarding" });
    else navigate({ to: "/coach/roster" });
  }, [data, navigate]);

  return null;
}
