import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AthleteBottomNav } from "@/components/athlete/bottom-nav";
import { RoomView } from "@/components/messages/room-view";

export const Route = createFileRoute("/_authenticated/athlete/messages/$roomId")({
  component: AthleteRoom,
});

function AthleteRoom() {
  const { roomId } = Route.useParams();
  return (
    <div className="mx-auto max-w-2xl px-3 pt-4 pb-24">
      <Link
        to="/athlete/messages"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" /> Messages
      </Link>
      <div className="mt-4">
        <RoomView roomId={roomId} viewerRole="athlete" />
      </div>
      <AthleteBottomNav />
    </div>
  );
}
