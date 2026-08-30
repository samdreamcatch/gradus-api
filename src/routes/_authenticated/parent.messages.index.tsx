import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { MessagesHeader } from "@/components/messages/messages-header";
import { RoomList } from "@/components/messages/room-list";
import { NewConversationButton } from "@/components/messages/new-conversation-button";
import { listMyRooms } from "@/lib/messages.functions";

export const Route = createFileRoute("/_authenticated/parent/messages/")({
  component: ParentMessages,
});

function ParentMessages() {
  const fetchRooms = useServerFn(listMyRooms);
  const { data, isLoading } = useQuery({
    queryKey: ["message-rooms", "parent"],
    queryFn: () => fetchRooms({ data: { viewerRole: "parent" } }),
  });
  const rooms = data?.rooms ?? [];

  return (
    <div className="mx-auto max-w-2xl px-3 pt-6 pb-app-chrome">
      <div className="flex items-start justify-between gap-3">
        <div>
          <MessagesHeader />
        </div>
        <div className="pt-3">
          <NewConversationButton
            basePath="/parent/messages"
            roomsQueryKey={["message-rooms", "parent"]}
            targetsQueryKey={["message-targets", "parent"]}
            emptyMessage="No coaches linked to your athletes yet."
          />
        </div>
      </div>
      <div className="mt-5">
        {isLoading ? (
          <p className="py-5 text-center text-sm text-text-secondary">Loading…</p>
        ) : (
          <RoomList
            rooms={rooms}
            emptyMessage="No conversations yet — tap New to start one."
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
