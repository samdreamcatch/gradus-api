import { motion, AnimatePresence } from "framer-motion";
import { X, Share, Plus } from "lucide-react";
import { useInstallPrompt } from "@/pwa/use-install-prompt";
import { Button } from "@/components/ui/button";
import { useBottomBannerLock } from "@/lib/bottom-banner-store";

export function InstallBanner() {
  const { status, promptInstall, dismiss } = useInstallPrompt();
  useBottomBannerLock(status !== "hidden");

  return (
    <AnimatePresence>
      {status !== "hidden" && (
        <motion.div
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="fixed inset-x-3 z-50 mx-auto max-w-md"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          }}
          role="dialog"
          aria-label="Install Gradus"
        >
          <div className="relative flex items-start gap-3 rounded-[var(--radius-lg)] bg-popover p-3 shadow-page ring-1 ring-divider">
            <img
              src="/icons/icon-192.png"
              alt=""
              className="h-12 w-12 flex-shrink-0 rounded-[var(--radius-md)]"
            />
            <div className="min-w-0 flex-1 pr-6">
              <p className="font-display text-base leading-tight text-text-primary">
                Install Gradus
              </p>
              {status === "installable" ? (
                <>
                  <p className="mt-0.5 text-sm text-text-secondary">
                    Add to your home screen for a faster, full-screen experience.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={promptInstall}>
                      Install
                    </Button>
                    <Button size="sm" variant="ghost" onClick={dismiss}>
                      Not now
                    </Button>
                  </div>
                </>
              ) : (
                <p className="mt-0.5 text-sm leading-snug text-text-secondary">
                  Tap{" "}
                  <Share
                    className="mx-0.5 inline h-4 w-4 -translate-y-0.5 text-accent-ink"
                    aria-label="Share"
                  />{" "}
                  then{" "}
                  <span className="whitespace-nowrap font-medium text-text-primary">
                    Add to Home Screen
                    <Plus className="ml-0.5 inline h-3.5 w-3.5 -translate-y-0.5" aria-hidden />
                  </span>
                  .
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="absolute right-2 top-2 rounded-full p-1 text-text-tertiary hover:bg-elevated hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
