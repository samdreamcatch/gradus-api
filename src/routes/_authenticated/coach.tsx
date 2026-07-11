import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/role-guard";
import { ConnectionCelebration } from "@/components/connection-celebration";

export const Route = createFileRoute("/_authenticated/coach")({
  beforeLoad: ({ context }) => requireRole("coach", context.queryClient),
  component: () => (
    <>
      <Outlet />
      <ConnectionCelebration role="coach" />
    </>
  ),
});

