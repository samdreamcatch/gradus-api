import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ensureRoom, sendMessage } from "@/lib/messages.functions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coachId: string;
  athleteId: string;
  coachFirstName: string;
  planId: string;
  planTitle: string;
  /** Where to navigate after sending (role-aware). */
  messagesBasePath: "/athlete/messages" | "/parent/messages" | "/coach/messages";
};

export function MessageCoachAboutPlanDialog({
  open,
  onOpenChange,
  coachId,
  athleteId,
  coachFirstName,
  planId,
  planTitle,
  messagesBasePath,
}: Props) {
  const [body, setBody] = useState("");
  const ensureRoomFn = useServerFn(ensureRoom);
  const sendMessageFn = useServerFn(sendMessage);
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: async (text: string) => {
      const { id: roomId } = await ensureRoomFn({ data: { coachId, athleteId } });
      const result = await sendMessageFn({
        data: { roomId, kind: "text", body: text, planId },
      });
      if (result && "ok" in result && result.ok === false) {
        throw new Error(result.message);
      }
      return roomId;
    },

    onSuccess: (roomId) => {
      setBody("");
      onOpenChange(false);
      navigate({ to: `${messagesBasePath}/${roomId}` });
    },
    onError: (e) => {
      toast("Couldn't send message", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    },
  });

  const submit = () => {
    const text = body.trim();
    if (!text || mutation.isPending) return;
    mutation.mutate(text);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Message Coach {coachFirstName}</DialogTitle>
          <DialogDescription>
            Your message will be tagged to this plan in your conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 inline-flex max-w-full items-center gap-1.5 self-start rounded-full bg-accent/15 px-2.5 py-1 text-[12px] font-semibold text-accent-ink">
          <ClipboardList className="size-3.5 shrink-0" />
          <span className="truncate">{planTitle}</span>
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Ask Coach ${coachFirstName} about this plan…`}
          rows={4}
          autoFocus
          disabled={mutation.isPending}
          className="mt-3 w-full resize-none rounded-xl border border-divider bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={!body.trim() || mutation.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-bold text-accent-foreground shadow-card disabled:opacity-50"
          >
            <Send className="size-4" />
            {mutation.isPending ? "Sending…" : "Send"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
