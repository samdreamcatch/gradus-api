import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ShareInviteButtonProps {
  /** Full URL to share. Must already include any invite/promo code param. */
  url: string;
  /** Native share sheet title. */
  title: string;
  /** Native share sheet message (also used in the clipboard fallback). */
  text: string;
  /** Button label. Defaults to "Share invite". */
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  disabled?: boolean;
  /** Fired after the share sheet is invoked or the fallback copy succeeds. */
  onShared?: () => void;
}

/**
 * Unified "invite your ___" call-to-action. Opens the OS-native share sheet
 * where available (iOS/Android/most modern browsers), falls back to copying
 * the message + link to the clipboard, and final-fallback toasts the URL.
 *
 * `navigator.share` MUST be called synchronously inside the click handler
 * — awaiting anything first breaks the iOS user-activation requirement.
 */
export function ShareInviteButton({
  url,
  title,
  text,
  label = "Share invite",
  variant = "default",
  size,
  className,
  disabled,
  onShared,
}: ShareInviteButtonProps) {
  const handleClick = () => {
    if (!url) return;
    const shareData = { title, text, url };
    const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

    if (canShare) {
      const p = navigator.share(shareData);
      onShared?.();
      p.catch((err: unknown) => {
        if ((err as DOMException)?.name === "AbortError") return;
        void fallbackCopy(text, url);
      });
      return;
    }
    void fallbackCopy(text, url).then(() => onShared?.());
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={disabled || !url}
      className={cn("shrink-0", className)}
    >
      <Share2 className="size-4" aria-hidden />
      {label}
    </Button>
  );
}

async function fallbackCopy(text: string, url: string) {
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast.success("Invite copied", { description: url });
  } catch {
    toast.success("Share this link", { description: url });
  }
}
