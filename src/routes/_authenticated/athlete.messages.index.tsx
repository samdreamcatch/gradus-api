import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AthleteBottomNav } from "@/components/athlete/bottom-nav";
import { MessagesHeader } from "@/components/messages/messages-header";
import { RoomList } from "@/components/messages/room-list";
import { NewConversationButton } from "@/components/messages/new-conversation-button";
import { listMyRooms } from "@/lib/messages.functions";

export const Route = createFileRoute("/_authenticated/athlete/messages/")({
  component: AthleteMessages,
});

function AthleteMessages() {
  const fetchRooms = useServerFn(listMyRooms);
  const { data, isLoading } = useQuery({
    queryKey: ["message-rooms", "athlete"],
    queryFn: () => fetchRooms(),
  });
  const rooms = data?.rooms ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <MessagesHeader subtitle="Your coaches" />
        </div>
        <div className="pt-3">
          <NewConversationButton
            basePath="/athlete/messages"
            roomsQueryKey={["message-rooms", "athlete"]}
            targetsQueryKey={["message-targets", "athlete"]}
            emptyMessage="No coaches linked to you yet."
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
              <Link to="/athlete/messages/$roomId" params={{ roomId }}>
                {children}
              </Link>
            )}
          />
        )}
      </div>
      <AthleteBottomNav />
    </div>
  );
}
