import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getOrgAdminContext } from "@/lib/org-admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { OrgAdminNavigation } from "@/components/org-admin/org-admin-sidebar";

export const Route = createFileRoute("/_authenticated/org-admin")({
  beforeLoad: async () => {
    try {
      const { organizations } = await getOrgAdminContext();
      if (!organizations || organizations.length === 0) {
        throw redirect({ to: "/" });
      }
    } catch (err) {
      if (err && typeof err === "object" && "to" in err) throw err;
      throw redirect({ to: "/" });
    }
  },
  component: OrgAdminLayout,
});

function OrgAdminLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // The club panel always follows the device's light/dark setting, whatever the app theme is.
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => root.classList.toggle("dark", mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      const saved = localStorage.getItem("gradus-theme") || "system";
      root.classList.toggle("dark", saved === "dark" || (saved === "system" && mq.matches));
    };
  }, []);

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  return (
      <div className="paper-surface min-h-screen flex w-full min-w-0 flex-col">
        <OrgAdminNavigation onSignOut={handleSignOut} />
        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 [&>div]:w-full [&>div]:min-w-0">
          <Outlet />
        </main>
      </div>
  );
}
