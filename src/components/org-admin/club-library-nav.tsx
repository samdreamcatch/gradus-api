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
  return <nav aria-label="Club library" className="flex min-w-0 gap-4 overflow-x-auto border-b border-divider">
    {pages.map((p) => <Button key={p.to} asChild variant="ghost" className={`press-soft h-11 shrink-0 rounded-none border-b-2 px-0 py-0 font-sans ${pathname === p.to ? "border-text-secondary font-semibold text-text-primary" : "border-transparent text-text-secondary"}`}>
      <Link to={p.to} aria-current={pathname === p.to ? "page" : undefined}>{p.label}</Link>
    </Button>)}
  </nav>;
}