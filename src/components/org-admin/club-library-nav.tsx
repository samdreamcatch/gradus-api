import { Link, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

const pages = [
  { to: "/org-admin/resources", label: "Resources" },
  { to: "/org-admin/policies", label: "Acknowledgements" },
  { to: "/org-admin/moves", label: "Moves" },
  { to: "/org-admin/templates", label: "Template plans" },
  { to: "/org-admin/builder", label: "Builder" },
  { to: "/org-admin/levels", label: "Levels" },
] as const;

export function ClubLibraryNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!pages.some((p) => pathname === p.to || pathname.startsWith(`${p.to}/`))) return null;
  return <nav aria-label="Club library" className="flex flex-wrap gap-2 border-b border-divider pb-3">
    {pages.map((p) => <Button key={p.to} asChild variant={pathname === p.to ? "secondary" : "ghost"} className="min-h-11 press-soft">
      <Link to={p.to} aria-current={pathname === p.to ? "page" : undefined}>{p.label}</Link>
    </Button>)}
  </nav>;
}