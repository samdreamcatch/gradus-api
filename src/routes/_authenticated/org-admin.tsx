import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { getOrgAdminContext } from "@/lib/org-admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { OrgAdminSidebar } from "@/components/org-admin/org-admin-sidebar";

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

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <OrgAdminSidebar />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-divider bg-card/85 backdrop-blur">
            <div className="flex items-center gap-3 px-4 py-3">
              <SidebarTrigger />
              <div className="flex-1 min-w-0" />
              <button
                onClick={handleSignOut}
                className="press shrink-0 inline-flex items-center gap-1.5 rounded-pill border border-divider px-3 py-1.5 text-xs text-text-secondary"
                title="Sign out"
              >
                <LogOut className="size-3.5" />
                Sign out
              </button>
            </div>
          </header>
          <Outlet />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
