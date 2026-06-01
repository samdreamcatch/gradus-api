import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { listCoachAthletes } from "@/lib/plans.functions";
import { ensureRoomForAthlete } from "@/lib/messages.functions";

export function NewConversationButton() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchAthletes = useServerFn(listCoachAthletes);
  const openRoom = useServerFn(ensureRoomForAthlete);

  const { data, isLoading } = useQuery({
    queryKey: ["coach-athletes-for-messages"],
    queryFn: () => fetchAthletes(),
    enabled: open,
  });

  const startMut = useMutation({
    mutationFn: (athleteId: string) => openRoom({ data: { athleteId } }),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["message-rooms", "coach"] });
      setOpen(false);
      navigate({ to: "/coach/messages/$roomId", params: { roomId: id } });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't open conversation"),
  });

  const athletes = data?.athletes ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" aria-hidden />
          New
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Start a conversation</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-text-secondary">Loading roster…</p>
        ) : athletes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-divider bg-card p-6 text-center">
            <MessageSquarePlus className="mx-auto mb-2 size-6 text-text-tertiary" aria-hidden />
            <p className="font-hand text-xl text-text-secondary">
              No athletes on your roster yet.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-divider overflow-hidden rounded-2xl border border-divider bg-card">
            {athletes.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  disabled={startMut.isPending}
                  onClick={() => startMut.mutate(a.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated disabled:opacity-60"
                >
                  <span className="truncate text-sm font-bold text-text-primary">{a.name}</span>
                  <span className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                    Message
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
