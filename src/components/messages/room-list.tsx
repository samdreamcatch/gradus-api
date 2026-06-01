import type { ReactNode } from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RoomSummary, RoleInRoom } from "@/lib/messages.functions";

function initialsFor(names: string[]): string {
  return names
    .map((n) => n.trim().charAt(0).toUpperCase())
    .filter(Boolean)
    .slice(0, 2)
    .join("");
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const wk = Math.floor(d / 7);
  if (wk < 5) return `${wk}w`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function roleLabel(role: RoleInRoom): string {
  switch (role) {
    case "coach":
      return "Coach";
    case "athlete":
      return "Athlete";
    case "parent":
      return "Parent";
  }
}

/**
 * Render the headline name(s) for a room from the current user's POV.
 * Shows everyone except "me".
 */
function others(
  room: RoomSummary,
): { display: string; people: { initial: string; role: RoleInRoom }[] } {
  const them = room.participants.filter((p) => p.role !== room.myRole);
  if (them.length === 0) return { display: "Conversation", people: [] };
  // Sort so athlete renders first (front), then parent/coach behind.
  const ordered = [...them].sort((a, b) => {
    const rank = (r: RoleInRoom) => (r === "athlete" ? 0 : r === "parent" ? 1 : 2);
    return rank(a.role) - rank(b.role);
  });
  const parts = ordered.map((p) => {
    const prefix =
      p.role === "coach" ? "Coach " : p.role === "parent" ? "Parent " : "";
    return `${prefix}${p.firstName}`.trim();
  });
  return {
    display: parts.join(" & "),
    people: ordered.map((p) => ({
      initial: p.firstName.trim().charAt(0).toUpperCase() || "·",
      role: p.role,
    })),
  };
}

export function RoomList({
  rooms,
  renderRoomLink,
  emptyMessage,
}: {
  rooms: RoomSummary[];
  /** Wrap the row in a router-aware link for the given room id. */
  renderRoomLink: (roomId: string, children: ReactNode) => ReactNode;
  emptyMessage: string;
}) {
  if (rooms.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
        <p className="font-hand text-2xl text-text-secondary">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-divider rounded-2xl border border-divider bg-card overflow-hidden">
      {rooms.map((room) => {
        const { display, people } = others(room);
        const last = room.lastMessage;
        const previewSenderPrefix =
          last && last.senderRole !== room.myRole
            ? `${roleLabel(last.senderRole)} ${last.senderFirstName.split(" ")[0]}: `
            : last
              ? "You: "
              : "";
        const previewBody = last
          ? last.kind === "voice"
            ? "Voice note"
            : last.body
          : "No messages yet — say hello.";

        const unread = room.unreadCount > 0;

        const front = people[0];
        const back = people[1];

        const inner = (
          <div className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none">
            <div className="relative size-11 shrink-0">
              {back ? (
                <div className="absolute right-0 top-0 grid size-8 place-items-center rounded-full bg-elevated text-[11px] font-black uppercase text-text-secondary ring-2 ring-card">
                  {back.initial}
                </div>
              ) : null}
              <div className="absolute bottom-0 left-0 grid size-8 place-items-center rounded-full bg-elevated text-[11px] font-black uppercase text-text-secondary ring-2 ring-card">
                {front?.initial ?? "·"}
              </div>
              {unread ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 inline-flex h-3 w-3 rounded-full bg-attention ring-2 ring-card"
                />
              ) : null}
            </div>

        const inner = (
          <div className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none">
            <div className="relative">
              <div className="grid size-11 shrink-0 place-items-center rounded-full bg-elevated text-sm font-black uppercase text-text-secondary ring-1 ring-divider">
                {initials || "·"}
              </div>
              {unread ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 inline-flex h-3 w-3 rounded-full bg-attention ring-2 ring-card"
                />
              ) : null}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={cn(
                    "truncate text-sm font-bold text-text-primary",
                    unread && "text-text-primary",
                  )}
                >
                  {display}
                </p>
                <span className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                  {relativeTime(room.updatedAt)}
                </span>
              </div>

              <div className="mt-0.5 flex items-center justify-between gap-2">
                <p
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 truncate text-sm",
                    unread ? "text-text-primary font-semibold" : "text-text-secondary",
                  )}
                >
                  {last?.kind === "voice" ? <Mic className="size-3.5 shrink-0" aria-hidden /> : null}
                  <span className="truncate">
                    {previewSenderPrefix}
                    {previewBody}
                  </span>
                </p>
                {unread ? (
                  <span className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-attention px-1.5 text-[11px] font-black text-attention-foreground">
                    {room.unreadCount}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        );

        return <li key={room.id}>{renderRoomLink(room.id, inner)}</li>;
      })}
    </ul>
  );
}
