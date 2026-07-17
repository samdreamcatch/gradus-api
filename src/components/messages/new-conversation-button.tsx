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
  ensureDirectRoom,
  type MessageTargetDTO,
} from "@/lib/messages.functions";

type Props = {
  basePath: "/coach/messages" | "/parent/messages" | "/athlete/messages";
  roomsQueryKey: readonly unknown[];
  targetsQueryKey: readonly unknown[];
  emptyMessage: ReactNode;
};

function targetKey(t: MessageTargetDTO, idx: number): string {
  if (t.kind === "athlete") return `a-${t.coachId}-${t.athleteId}-${idx}`;
  if (t.kind === "coach_coach") return `cc-${t.otherCoachId}-${idx}`;
  return `cp-${t.parentId}-${idx}`;
}

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
  const openDirect = useServerFn(ensureDirectRoom);

  const { data, isLoading } = useQuery({
    queryKey: targetsQueryKey,
    queryFn: () => fetchTargets(),
    enabled: open,
  });

  const startMut = useMutation({
    mutationFn: async (t: MessageTargetDTO) => {
      if (t.kind === "athlete") {
        return openRoom({ data: { coachId: t.coachId, athleteId: t.athleteId } });
      }
      if (t.kind === "coach_coach") {
        return openDirect({ data: { kind: "coach_coach", otherCoachId: t.otherCoachId } });
      }
      return openDirect({ data: { kind: "coach_parent", parentId: t.parentId } });
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: roomsQueryKey });
      setOpen(false);
      navigate({ to: `${basePath}/$roomId`, params: { roomId: id } });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't open conversation"),
  });

  const targets: MessageTargetDTO[] = data?.targets ?? [];
  const grouped = new Map<string, MessageTargetDTO[]>();
  for (const t of targets) {
    const arr = grouped.get(t.group) ?? [];
    arr.push(t);
    grouped.set(t.group, arr);
  }
  const groupOrder = ["Athletes", "Parents", "Coaches"] as const;

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
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {groupOrder.map((group) => {
              const items = grouped.get(group);
              if (!items || items.length === 0) return null;
              return (
                <div key={group}>
                  <p className="mb-1.5 text-caption font-bold uppercase tracking-widest text-text-tertiary">
                    {group}
                  </p>
                  <ul className="divide-y divide-divider overflow-hidden rounded-2xl border border-divider bg-card">
                    {items.map((t, idx) => (
                      <li key={targetKey(t, idx)}>
                        <button
                          type="button"
                          disabled={startMut.isPending}
                          onClick={() => startMut.mutate(t)}
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
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
