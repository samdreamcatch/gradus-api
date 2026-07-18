import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { checkIsAdmin } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { Eyebrow } from "@/components/ui/eyebrow";
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

type NavItem = { to: string; label: string; exact?: boolean; search?: Record<string, unknown> };

function AdminLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const includeTest = Boolean((search as any)?.test);

  const nav: NavItem[] = [
    { to: "/admin", label: "Overview", exact: true, search: { test: includeTest } },
    { to: "/admin/feedback", label: "Feedback", search: { type: "all", unresolved: false } },
    { to: "/admin/errors", label: "Errors", search: { test: includeTest } },
    { to: "/admin/promo-codes", label: "Promo codes" },
    { to: "/admin/organizations", label: "Organizations" },
    { to: "/admin/emails", label: "Email copy", search: { t: "signup" } },
    { to: "/admin/map", label: "Connection map", search: { test: includeTest } },
  ];

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  return (
    <div>
      <header className="sticky top-0 z-30 border-b border-divider bg-card/85 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
            <div className="min-w-0">
              <Eyebrow size="small" tone="accent-ink">Internal</Eyebrow>
              <h1 className="font-display text-h2 text-text-primary truncate">Admin</h1>
            </div>
            <div className="col-span-2 -mx-4 sm:mx-0 overflow-x-auto">
              <nav className="flex items-center gap-2 px-4 sm:px-0 sm:flex-wrap sm:justify-end">
                {nav.map((item) => (
                  <AdminNavLink key={item.to} to={item.to} exact={item.exact} search={item.search}>
                    {item.label}
                  </AdminNavLink>
                ))}
                <span className="mx-1 h-6 w-px shrink-0 bg-divider" aria-hidden />
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
              </nav>
            </div>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

function AdminNavLink({
  to,
  exact,
  search,
  children,
}: {
  to: string;
  exact?: boolean;
  search?: Record<string, unknown>;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to as any}
      search={search as any}
      activeOptions={{ exact: !!exact }}
      className="press shrink-0 rounded-pill border border-divider px-3 py-1.5 text-sm text-text-primary"
      activeProps={{
        className: "press shrink-0 rounded-pill border border-accent bg-accent px-3 py-1.5 text-sm text-accent-foreground",
      }}
    >
      {children}
    </Link>
  );
}
