import { useState, type ReactNode } from "react";
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
import {
  listMyMessageTargets,
  ensureRoomForTarget,
  type MessageTargetDTO,
} from "@/lib/messages.functions";

type Props = {
  basePath: "/coach/messages" | "/parent/messages";
  roomsQueryKey: readonly unknown[];
  targetsQueryKey: readonly unknown[];
  emptyMessage: ReactNode;
};

export function NewConversationButton({
  basePath,
  roomsQueryKey,
  targetsQueryKey,
  emptyMessage,
}: Props) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchTargets = useServerFn(listMyMessageTargets);
  const openRoom = useServerFn(ensureRoomForTarget);

  const { data, isLoading } = useQuery({
    queryKey: targetsQueryKey,
    queryFn: () => fetchTargets(),
    enabled: open,
  });

  const startMut = useMutation({
    mutationFn: (athleteId: string) => openRoom({ data: { athleteId } }),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: roomsQueryKey });
      setOpen(false);
      navigate({ to: `${basePath}/$roomId`, params: { roomId: id } });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't open conversation"),
  });

  const targets: MessageTargetDTO[] = data?.targets ?? [];

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
          <p className="py-6 text-center text-sm text-text-secondary">Loading…</p>
        ) : targets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-divider bg-card p-6 text-center">
            <MessageSquarePlus className="mx-auto mb-2 size-6 text-text-tertiary" aria-hidden />
            <p className="font-hand text-xl text-text-secondary">{emptyMessage}</p>
          </div>
        ) : (
          <ul className="divide-y divide-divider overflow-hidden rounded-2xl border border-divider bg-card">
            {targets.map((t, idx) => (
              <li key={`${t.athleteId}-${idx}`}>
                <button
                  type="button"
                  disabled={startMut.isPending}
                  onClick={() => startMut.mutate(t.athleteId)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-text-primary">
                      {t.primaryLabel}
                    </span>
                    {t.secondaryLabel ? (
                      <span className="block truncate text-[12px] text-text-tertiary">
                        {t.secondaryLabel}
                      </span>
                    ) : null}
                  </span>
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
