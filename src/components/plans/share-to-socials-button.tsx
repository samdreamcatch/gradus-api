import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { Share2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getOrCreateShareToken } from "@/lib/plan-share.functions";

const SITE_ORIGIN = "https://gradus.training";

export function ShareToSocialsButton({
  planId,
  planTitle,
  className,
}: {
  planId: string;
  planTitle: string;
  className?: string;
}) {
  const shareFn = useServerFn(getOrCreateShareToken);
  const [busy, setBusy] = useState(false);

  const mutation = useMutation({
    mutationFn: () => shareFn({ data: { planId } }),
  });

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { token } = await mutation.mutateAsync();
      const url = `${SITE_ORIGIN}/p/${token}`;
      const caption = `${planTitle} — a workout I put together on Gradus.`;

      const canShare =
        typeof navigator !== "undefined" && typeof navigator.share === "function";
      if (canShare) {
        try {
          await navigator.share({ title: planTitle, text: caption, url });
          return;
        } catch (err) {
          // User canceled or share failed — fall through to copy.
          if ((err as DOMException)?.name === "AbortError") return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied", { description: url });
      } catch {
        toast.success("Share link", { description: url });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create share link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-divider bg-card px-3 py-1.5 text-[12px] font-bold text-text-primary shadow-card hover:border-accent/60",
        busy && "opacity-70",
        className,
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
      Share to socials
    </button>
  );
}
