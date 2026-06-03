import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "@/components/logo";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
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
    if (!status.hasParentProfile) return;
    if (status.hasAthletes) return;
    if (status.inviteCode) {
      navigate({
        to: "/signup/parent/athletes",
        search: { code: status.inviteCode },
      });
    } else {
      navigate({ to: "/signup/parent" });
    }
  }, [status, navigate]);

  return (
    <div className="mx-auto max-w-2xl px-3 py-6 pb-24">
      <Logo className="text-4xl" />
      <h1 className="mt-6 font-display text-3xl text-text-primary">
        Welcome back.
      </h1>
      <p className="mt-3 text-text-secondary">
        Jump into <span className="pen-highlight">Plans</span> to check in on
        your athletes, head to <span className="pen-highlight">Messages</span>{" "}
        to talk with your coach, or open{" "}
        <span className="pen-highlight">Settings</span> to manage your account
        and athletes.
      </p>
      <ParentBottomNav />
    </div>
  );
}
