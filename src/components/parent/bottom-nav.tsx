import { Link, useRouterState } from "@tanstack/react-router";
import { ClipboardList, MessageSquare, BookOpen, Settings, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/eyebrow";
import { useMessagesUnread } from "@/hooks/use-messages-unread";

type Item = {
  label: string;
  icon: LucideIcon;
  to?: string;
  /** Match when pathname starts with this prefix (in addition to exact `to`). */
  matchPrefix?: string;
  /** When > 0, renders an attention dot on the icon. */
  unreadCount?: number;
};

export function ParentBottomNav({
  disabled = false,
  onDisabledTap,
}: {
  /** Render the bar greyed out and non-navigating (signed-out board). */
  disabled?: boolean;
  onDisabledTap?: () => void;
} = {}) {
  const unread = useMessagesUnread();
  const ITEMS: Item[] = [
    { label: "Plans", icon: ClipboardList, to: "/parent/plans", matchPrefix: "/parent/plans" },
    {
      label: "Messages",
      icon: MessageSquare,
      to: "/parent/messages",
      matchPrefix: "/parent/messages",
      unreadCount: unread,
    },
    {
      label: "Resources",
      icon: BookOpen,
      to: "/parent/resources",
      matchPrefix: "/parent/resources",
    },
    { label: "Settings", icon: Settings, to: "/parent/settings", matchPrefix: "/parent/settings" },
  ];
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      aria-label="Parent navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-divider bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.12)]"
    >
      <ul className="mx-auto flex min-h-16 max-w-3xl items-stretch justify-around px-1">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = !disabled && item.to
            ? item.matchPrefix
              ? pathname === item.to || pathname.startsWith(item.matchPrefix + "/")
              : pathname === item.to
            : false;

          const hasUnread = !disabled && (item.unreadCount ?? 0) > 0;

          const inner = (
            <span
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 transition-colors",
                isActive
                  ? "text-accent-ink"
                  : !disabled && item.to
                    ? "text-text-secondary hover:text-text-primary"
                    : "text-text-tertiary",
              )}
            >
              <span className="relative">
                <Icon
                  className={cn("h-[18px] w-[18px]", isActive && "text-accent-ink")}
                  aria-hidden
                />
                {hasUnread ? (
                  <span
                    aria-label={`${item.unreadCount} unread`}
                    className="absolute -right-1 -top-0.5 inline-flex h-2 w-2 rounded-full bg-attention ring-2 ring-card"
                  />
                ) : null}
              </span>
              <Eyebrow
                as="span"
                size="micro"
                tracking="wide"
                weight="bold"
                tone={isActive ? "accent-ink" : !disabled && item.to ? "secondary" : "tertiary"}
                className={cn("max-w-full truncate leading-none", isActive && "pen-highlight")}
              >
                {item.label}
              </Eyebrow>
            </span>
          );

          return (
            <li key={item.label} className="flex flex-1">
              {item.to && !disabled ? (
                <Link
                  to={item.to}
                  className="focus-surface flex flex-1 cursor-pointer rounded-md"
                  aria-current={isActive ? "page" : undefined}
                >
                  {inner}
                </Link>
              ) : (
                <button
                  type="button"
                  aria-disabled={disabled || undefined}
                  onClick={() =>
                    disabled ? onDisabledTap?.() : toast(`${item.label} coming soon`)
                  }
                  className="focus-surface flex flex-1 cursor-pointer rounded-md"
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
