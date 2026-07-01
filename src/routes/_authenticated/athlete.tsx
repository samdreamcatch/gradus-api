import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/role-guard";

export const Route = createFileRoute("/_authenticated/athlete")({
  beforeLoad: ({ context }) => requireRole("athlete", context.queryClient),
  component: () => <Outlet />,
});
