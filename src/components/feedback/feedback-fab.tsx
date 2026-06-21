import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { MessageSquarePlus, Bug, Lightbulb, Heart, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { submitFeedback } from "@/lib/feedback.functions";
import { useBottomBannerLocked } from "@/lib/bottom-banner-store";
import { cn } from "@/lib/utils";

type FeedbackType = "bug" | "idea" | "praise" | "other";

const TYPES: { value: FeedbackType; label: string; icon: typeof Bug }[] = [
  { value: "bug", label: "Bug", icon: Bug },
  { value: "idea", label: "Idea", icon: Lightbulb },
  { value: "praise", label: "Praise", icon: Heart },
  { value: "other", label: "Other", icon: MoreHorizontal },
];

export function FeedbackFab() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("idea");
  const [message, setMessage] = useState("");

  const submitFn = useServerFn(submitFeedback);
  const mutation = useMutation({
    mutationFn: submitFn,
    onSuccess: () => {
      toast("Thanks — got it.", { description: "We read every one of these." });
      setOpen(false);
      setMessage("");
      setType("idea");
    },
    onError: (e) => {
      toast.error("Couldn't send feedback", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    },
  });

  const handleSubmit = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    mutation.mutate({
      data: {
        type,
        message: trimmed,
        path:
          typeof window !== "undefined"
            ? window.location.pathname + window.location.search
            : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
        viewport:
          typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : null,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Gradus is in beta, share feedback"
          className="fixed bottom-20 left-4 z-30 inline-flex items-center gap-2 rounded-pill bg-accent px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-accent-foreground shadow-card transition-transform hover:scale-105 active:scale-95 md:bottom-6"
        >
          <MessageSquarePlus className="size-4" />
          <span>Gradus is in beta, share feedback</span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="text-[11px] font-black uppercase tracking-widest text-accent-ink">
            Feedback
          </p>
          <DialogTitle className="font-display text-2xl font-black leading-tight text-text-primary">
            Send us a note
          </DialogTitle>
          <DialogDescription className="sr-only">
            Share a bug, idea, or anything else.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => {
              const Icon = t.icon;
              const active = type === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition",
                    active
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-divider bg-card text-text-secondary hover:bg-elevated",
                  )}
                >
                  <Icon className="size-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="What's on your mind?"
            className="w-full resize-none rounded-xl border border-divider bg-elevated px-3 py-2 text-[15px] leading-relaxed text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />


          <button
            type="button"
            onClick={handleSubmit}
            disabled={!message.trim() || mutation.isPending}
            className={cn(
              "w-full rounded-full px-5 py-3 text-sm font-bold shadow-card transition-opacity",
              message.trim() && !mutation.isPending
                ? "bg-accent text-accent-foreground"
                : "cursor-not-allowed bg-divider text-text-tertiary opacity-70",
            )}
          >
            {mutation.isPending ? "Sending…" : "Send"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
