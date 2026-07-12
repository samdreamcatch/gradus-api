import type { ReactNode } from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { SportsPoster } from "@/components/ui/sports-poster";
import type { RoomSummary, RoleInRoom } from "@/lib/messages.functions";


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
function others(room: RoomSummary): { display: string } {
  const them = room.participants.filter(
    (p) => p.userId !== room.myUserId && p.role !== room.myRole,
  );
  if (them.length === 0) return { display: "Conversation" };
  const ordered = [...them].sort((a, b) => {
    const rank = (r: RoleInRoom) => (r === "athlete" ? 0 : r === "parent" ? 1 : 2);
    return rank(a.role) - rank(b.role);
  });
  const parts = ordered.map((p) => {
    const prefix =
      p.role === "coach" ? "Coach " : p.role === "parent" ? "Parent " : "";
    return `${prefix}${p.firstName}`.trim();
  });
  return { display: parts.join(" & ") };
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
      <div className="relative overflow-hidden rounded-2xl border border-dashed border-divider bg-card p-8 text-center">
        <SportsPoster fill opacity={0.08} />
        <p className="relative font-hand text-2xl text-text-secondary">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {rooms.map((room) => {
        const { display } = others(room);
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


        const inner = (
          <div
            className={cn(
              "flex items-start gap-3 rounded-2xl border bg-card px-4 py-3.5 shadow-card transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none",
              unread ? "border-accent" : "border-divider",
            )}
          >
            {unread ? (
              <span
                aria-hidden
                className="mt-2 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-attention"
              />
            ) : null}

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
                <span className="shrink-0 text-caption font-bold uppercase tracking-widest text-text-tertiary">
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
