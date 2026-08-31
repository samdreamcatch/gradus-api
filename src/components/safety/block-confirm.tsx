import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { blockUser } from "@/lib/safety.functions";

export function BlockConfirm({
  open,
  onOpenChange,
  targetUserId,
  targetName,
  onBlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetUserId: string;
  targetName: string;
  onBlocked?: () => void;
}) {
  const qc = useQueryClient();
  const block = useServerFn(blockUser);
  const mutation = useMutation({
    mutationFn: block,
    onSuccess: () => {
      toast(`${targetName} is blocked.`, {
        description: "You can unblock them in Account & security.",
      });
      onOpenChange(false);
      void qc.invalidateQueries();
      onBlocked?.();
    },
    onError: (e) => {
      toast.error("Couldn't block this person", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Block {targetName}?</AlertDialogTitle>
          <AlertDialogDescription>
            You will no longer be able to message each other, and any coaching connection between
            you will be removed. Past conversations stay in your history. You can unblock them
            later in Account &amp; security, but the connection won&apos;t come back on its own.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white"
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate({ data: { targetUserId } });
            }}
          >
            {mutation.isPending ? "Blocking…" : "Block"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
