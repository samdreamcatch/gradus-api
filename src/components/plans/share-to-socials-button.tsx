import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Share2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getOrCreateShareToken } from "@/lib/plan-share.functions";

const SITE_ORIGIN = "https://gradus.training";

export function ShareToSocialsButton({
  planId,
  planTitle,
  className,
  variant = "chip",
}: {
  planId: string;
  planTitle: string;
  className?: string;
  variant?: "chip" | "primary";
}) {

  const shareFn = useServerFn(getOrCreateShareToken);
  const [busy, setBusy] = useState(false);

  // Prefetch the token on mount so the click handler can call
  // navigator.share() synchronously and preserve user activation
  // (required by Safari / iOS for the native share sheet).
  const { data: prefetched } = useQuery({
    queryKey: ["plan-share-token", planId],
    queryFn: () => shareFn({ data: { planId } }),
    enabled: !!planId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const copyFallback = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied", { description: url });
    } catch {
      toast.success("Share link", { description: url });
    }
  };

  const onClick = async () => {
    if (busy) return;
    const caption = `${planTitle} — My workout on Gradus`;
    const canShare =
      typeof navigator !== "undefined" && typeof navigator.share === "function";

    // Hot path: token already cached — invoke share sheet synchronously
    // in the click handler to keep user activation alive.
    if (prefetched?.token) {
      const url = `${SITE_ORIGIN}/p/${prefetched.token}`;
      if (canShare) {
        try {
          await navigator.share({ title: planTitle, text: caption, url });
          return;
        } catch (err) {
          if ((err as DOMException)?.name === "AbortError") return;
          // fall through to copy
        }
      }
      await copyFallback(url);
      return;
    }

    // Cold path: token not ready yet. Awaiting the server fn consumes user
    // activation, so Safari won't open the share sheet — copy instead.
    setBusy(true);
    try {
      const { token } = await shareFn({ data: { planId } });
      const url = `${SITE_ORIGIN}/p/${token}`;
      await copyFallback(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create share link.");
    } finally {
      setBusy(false);
    }
  };

  const primary = variant === "primary";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        primary
          ? "inline-flex items-center gap-2 rounded-full border border-accent bg-accent px-4 py-2 text-[13px] font-black uppercase tracking-widest text-accent-foreground shadow-card hover:opacity-90"
          : "inline-flex items-center gap-1.5 rounded-full border border-divider bg-card px-3 py-1.5 text-[12px] font-bold text-text-primary shadow-card hover:border-accent/60",
        busy && "opacity-70",
        className,
      )}
    >
      {busy ? (
        <Loader2 className={cn(primary ? "size-4 animate-spin" : "size-3.5 animate-spin")} />
      ) : (
        <Share2 className={cn(primary ? "size-4" : "size-3.5")} />
      )}
      Share to socials
    </button>
  );
}

