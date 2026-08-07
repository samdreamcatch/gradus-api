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
import { ensureRoom, ensureDirectRoom, sendMessage } from "@/lib/messages.functions";

type CommonProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coachFirstName: string;
  planId: string;
  planTitle: string;
};

type AthleteRoomProps = CommonProps & {
  mode?: "athlete-room";
  coachId: string;
  athleteId: string;
  messagesBasePath: "/athlete/messages" | "/parent/messages" | "/coach/messages";
};

type CoachDirectProps = CommonProps & {
  mode: "coach-direct";
  otherCoachId: string;
};

type Props = AthleteRoomProps | CoachDirectProps;

export function MessageCoachAboutPlanDialog(props: Props) {
  const { open, onOpenChange, coachFirstName, planId, planTitle } = props;
  const [body, setBody] = useState("");
  const ensureRoomFn = useServerFn(ensureRoom);
  const ensureDirectRoomFn = useServerFn(ensureDirectRoom);
  const sendMessageFn = useServerFn(sendMessage);
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: async (text: string) => {
      let roomId: string;
      if (props.mode === "coach-direct") {
        const res = await ensureDirectRoomFn({
          data: { kind: "coach_coach", otherCoachId: props.otherCoachId },
        });
        roomId = res.id;
      } else {
        const res = await ensureRoomFn({
          data: { coachId: props.coachId, athleteId: props.athleteId },
        });
        roomId = res.id;
      }
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
      const base = props.mode === "coach-direct" ? "/coach/messages" : props.messagesBasePath;
      navigate({ to: `${base}/${roomId}` });
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
          className="mt-3 w-full resize-none rounded-xl border border-divider bg-foreground/[0.04] px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40 dark:bg-foreground/5"
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
