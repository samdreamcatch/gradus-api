import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, ClipboardList, MessageSquare, BookOpen, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useMessagesUnread } from "@/hooks/use-messages-unread";

type Item = {
  label: string;
  icon: LucideIcon;
  to?: string;
  matchPrefix?: string;
  unreadCount?: number;
};

export function AthleteBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      aria-label="Athlete navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-divider bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.12)]"
    >
      <ul className="mx-auto flex max-w-3xl items-stretch justify-around px-2">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.to
            ? item.matchPrefix
              ? pathname === item.to || pathname.startsWith(item.matchPrefix + "/")
              : pathname === item.to
            : false;

          const hasUnread = (item.unreadCount ?? 0) > 0;

          const inner = (
            <span
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors",
                isActive
                  ? "text-accent-ink"
                  : item.to
                    ? "text-text-secondary hover:text-text-primary"
                    : "text-text-tertiary",
              )}
            >
              <span className="relative">
                <Icon className={cn("h-5 w-5", isActive && "text-accent-ink")} aria-hidden />
                {hasUnread ? (
                  <span
                    aria-label={`${item.unreadCount} unread`}
                    className="absolute -right-1 -top-0.5 inline-flex h-2 w-2 rounded-full bg-attention ring-2 ring-card"
                  />
                ) : null}
              </span>
              <span className={cn("leading-none", isActive && "pen-highlight")}>{item.label}</span>
            </span>
          );

          return (
            <li key={item.label} className="flex flex-1">
              {item.to ? (
                <Link
                  to={item.to}
                  className="flex flex-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
                  aria-current={isActive ? "page" : undefined}
                >
                  {inner}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => toast(`${item.label} coming soon`)}
                  className="flex flex-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
