import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { MessagesHeader } from "@/components/messages/messages-header";
import { RoomList } from "@/components/messages/room-list";
import { listMyRooms } from "@/lib/messages.functions";

export const Route = createFileRoute("/_authenticated/parent/messages/")({
  component: ParentMessages,
});

function ParentMessages() {
  const fetchRooms = useServerFn(listMyRooms);
  const { data, isLoading } = useQuery({
    queryKey: ["message-rooms", "parent"],
    queryFn: () => fetchRooms(),
  });
  const rooms = data?.rooms ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 pb-24">
      <MessagesHeader subtitle="Your athlete's coaches" />
      <div className="mt-5">
        {isLoading ? (
          <p className="py-5 text-center text-sm text-text-secondary">Loading…</p>
        ) : (
          <RoomList
            rooms={rooms}
            emptyMessage="No conversations yet — they'll appear once a coach reaches out."
            renderRoomLink={(roomId, children) => (
              <Link to="/parent/messages/$roomId" params={{ roomId }}>
                {children}
              </Link>
            )}
          />
        )}
      </div>
      <ParentBottomNav />
    </div>
  );
}
