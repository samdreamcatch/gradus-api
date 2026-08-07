import {
  createFileRoute,
  Outlet,
  redirect,
  Link,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { checkIsAdmin } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    try {
      const { isAdmin } = await checkIsAdmin();
      if (!isAdmin) throw redirect({ to: "/" });
    } catch (err) {
      if (err && typeof err === "object" && "to" in err) throw err;
      throw redirect({ to: "/" });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const includeTest = Boolean((search as any)?.test);

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AdminSidebar />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-divider bg-card/85 backdrop-blur">
            <div className="flex items-center gap-3 px-4 py-3">
              <SidebarTrigger />
              <div className="flex-1 min-w-0" />
              <Link
                from="/admin"
                search={(prev: any) => ({ ...prev, test: !includeTest })}
                className={cn(
                  "press shrink-0 rounded-pill border px-3 py-1.5 text-xs font-mono uppercase tracking-wide",
                  includeTest
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-divider text-text-secondary",
                )}
                title="Toggle test users"
              >
                {includeTest ? "test ✓" : "test"}
              </Link>
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
