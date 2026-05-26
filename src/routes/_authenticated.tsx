import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    // getUser() re-verifies the JWT with the Auth server rather than trusting
    // a cached session in localStorage. This closes the route-guard gap flagged
    // by the security scan (ROUTE_ONLY_AUTH_NO_SERVER_GUARD).
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: () => <Outlet />,
});
