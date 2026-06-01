import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { RoomView } from "@/components/messages/room-view";

export const Route = createFileRoute("/_authenticated/coach/messages/$roomId")({
  component: CoachRoom,
});

function CoachRoom() {
  const { roomId } = Route.useParams();
  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-24">
      <Link
        to="/coach/messages"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" /> Messages
      </Link>
      <div className="mt-4">
        <RoomView roomId={roomId} />
      </div>
      <CoachBottomNav />
    </div>
  );
}
