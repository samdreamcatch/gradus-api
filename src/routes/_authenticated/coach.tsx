import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/coach")({
  beforeLoad: ({ context }) => requireRole("coach", context.queryClient),
  component: () => <Outlet />,
});
