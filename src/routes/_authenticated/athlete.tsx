import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/role-guard";
import { ConnectionCelebration } from "@/components/connection-celebration";

export const Route = createFileRoute("/_authenticated/athlete")({
  beforeLoad: ({ context }) => requireRole("athlete", context.queryClient, context.user?.id),
  component: () => (
    <>
      <Outlet />
      <ConnectionCelebration role="adult-athlete" />
    </>
  ),
});
