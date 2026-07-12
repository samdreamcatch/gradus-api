import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PartyPopper, MessageCircle, CalendarDays, ClipboardList } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SportsPoster } from "@/components/ui/sports-poster";
import {
  acknowledgeConnection,
  getPendingConnectionCelebrations,
  type CelebrationGroup,
  type CelebrationRole,
} from "@/lib/connection-celebration.functions";

interface ConnectionCelebrationProps {
  role: Extract<CelebrationRole, "coach" | "parent" | "adult-athlete">;
}

/**
 * Mount once per role dashboard. Polls once for unacked coach ↔ athlete
 * links, and shows a celebratory modal for each pending group. Any CTA or
 * dismiss action marks the group acknowledged so it never re-appears.
 */
export function ConnectionCelebration({ role }: ConnectionCelebrationProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchPending = useServerFn(getPendingConnectionCelebrations);
  const ack = useServerFn(acknowledgeConnection);

  const { data } = useQuery({
    queryKey: ["connection-celebrations", role],
    queryFn: () => fetchPending(),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const ackMutation = useMutation({
    mutationFn: (linkIds: string[]) => ack({ data: { linkIds } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connection-celebrations", role] });
      // Related caches that depend on link presence
      if (role === "coach") {
        queryClient.invalidateQueries({ queryKey: ["coach-roster"] });
      } else if (role === "parent") {
        queryClient.invalidateQueries({ queryKey: ["parent-signup-status"] });
      }
    },
  });

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [confettiKey, setConfettiKey] = useState(0);

  const currentGroup = groups.find(
    (g) => !g.linkIds.some((id) => dismissedIds.has(id)),
  );

  useEffect(() => {
    if (currentGroup) setConfettiKey((k) => k + 1);
  }, [currentGroup?.linkIds.join(",")]);

  if (!currentGroup) return null;

  const dismiss = (group: CelebrationGroup) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      for (const id of group.linkIds) next.add(id);
      return next;
    });
    ackMutation.mutate(group.linkIds);
  };

  const handleAction = (group: CelebrationGroup, action: () => void) => {
    dismiss(group);
    action();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) dismiss(currentGroup);
      }}
    >
      <DialogContent className="max-w-sm overflow-hidden border-divider bg-popover">
        <SportsPoster fill opacity={0.08} />
        <ConfettiBurst key={confettiKey} />


        <DialogHeader className="relative items-center text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-accent/20 text-accent-ink shadow-sm ring-1 ring-accent/30">
            <PartyPopper className="h-7 w-7" aria-hidden />
          </div>
          <DialogTitle className="font-display text-2xl font-black text-text-primary">
            {role === "coach"
              ? `You're connected with ${formatCoachTitle(currentGroup)}!`
              : `You're connected with ${currentGroup.otherName || "your coach"}!`}
          </DialogTitle>
          <DialogDescription className="text-sm text-text-secondary">
            {role === "coach"
              ? "Take a moment to get set up — pick a next step below."
              : "Say hi so they know you're here."}
          </DialogDescription>
        </DialogHeader>


        {role === "coach" ? (
          <div className="relative mt-4 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-auto flex-col gap-1 bg-card py-3"
              onClick={() =>
                handleAction(currentGroup, () => {
                  navigate({ to: "/coach/roster" });
                })
              }
            >
              <CalendarDays className="h-5 w-5" aria-hidden />
              <span className="text-xs font-bold">View schedule</span>
            </Button>
            <Button
              type="button"
              className="h-auto flex-col gap-1 py-3"
              onClick={() =>
                handleAction(currentGroup, () => {
                  navigate({ to: "/coach/plans" });
                })
              }
            >
              <ClipboardList className="h-5 w-5" aria-hidden />
              <span className="text-xs font-bold">Assign first plan</span>
            </Button>
          </div>
        ) : (
          <div className="relative mt-4">
            <Button
              type="button"
              className="w-full gap-2"
              onClick={() =>
                handleAction(currentGroup, () => {
                  const base =
                    role === "parent" ? "/parent/messages" : "/athlete/messages";
                  if (currentGroup.roomId) {
                    navigate({
                      to: `${base}/$roomId`,
                      params: { roomId: currentGroup.roomId },
                    });
                  } else {
                    navigate({ to: base });
                  }
                })
              }
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              Say hello
            </Button>
          </div>
        )}

        <button
          type="button"
          onClick={() => dismiss(currentGroup)}
          className="relative mt-3 w-full text-center text-xs font-medium text-text-tertiary hover:text-text-secondary"
        >

          Maybe later
        </button>
      </DialogContent>
    </Dialog>
  );
}

function formatCoachTitle(group: CelebrationGroup): string {
  const names = group.athleteNames.filter(Boolean);
  if (names.length === 0) return group.otherName || "your new athlete";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/**
 * Small pen-color confetti burst rendered inside the dialog. CSS-only,
 * no runtime dep. Restarts by remounting via key change.
 */
function ConfettiBurst() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.2,
        duration: 1.2 + Math.random() * 0.9,
        rotate: Math.random() * 360,
      })),

    [],
  );
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-40 overflow-hidden"
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            left: `${p.left}%`,
            background: "var(--accent)",
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
          className="absolute top-0 h-2 w-1.5 rounded-[1px] animate-[celebration-fall_linear_forwards]"
        />
      ))}
    </div>
  );
}
