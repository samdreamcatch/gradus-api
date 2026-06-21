import { useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { MessageSquarePlus } from "lucide-react";
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

function FeedbackDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  const submitFn = useServerFn(submitFeedback);
  const mutation = useMutation({
    mutationFn: submitFn,
    onSuccess: () => {
      toast("Thanks — got it.", { description: "We read every one of these." });
      setOpen(false);
      setMessage("");
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
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="top-4 translate-y-0 sm:top-[50%] sm:max-w-md sm:translate-y-[-50%]">
        <DialogHeader>
          <p className="text-[11px] font-black uppercase tracking-widest text-accent-ink">
            Feedback
          </p>
          <DialogTitle className="font-display text-2xl font-black leading-tight text-text-primary">
            Your feedback shapes what we build
          </DialogTitle>
          <DialogDescription className="sr-only">
            Share a bug, idea, or anything else.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder=""
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

export function FeedbackFab() {
  const bannerLocked = useBottomBannerLocked();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Hide the persistent banner on settings pages — it overlaps the sign-out
  // button on mobile. Settings pages get a dedicated feedback row instead.
  if (pathname.endsWith("/settings")) return null;

  return (
    <FeedbackDialog
      trigger={
        <button
          type="button"
          aria-label="Gradus is in beta, share feedback"
          className={cn(
            "fixed bottom-24 left-4 z-30 inline-flex items-center gap-2 rounded-pill bg-attention px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-[#0A2540] shadow-card transition-all hover:scale-105 active:scale-95 md:bottom-6",
            bannerLocked && "pointer-events-none translate-y-4 opacity-0",
          )}
        >
          <MessageSquarePlus className="size-4" />
          <span>Gradus is in beta, share feedback</span>
        </button>
      }
    />
  );
}

export function FeedbackSettingsRow() {
  return (
    <FeedbackDialog
      trigger={
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-accent-ink transition hover:bg-elevated/50"
        >
          <span className="shrink-0">
            <MessageSquarePlus className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">Share feedback</div>
            <div className="mt-0.5 text-xs text-text-tertiary">
              Gradus is in beta — tell us what to fix or build
            </div>
          </div>
        </button>
      }
    />
  );
}
