import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { SW_UPDATE_EVENT } from "@/pwa/register-sw";

/**
 * Surfaces a "new version available" toast when the service worker picks up a
 * fresh build. Installed (PWA) sessions can otherwise keep running an old
 * bundle for days after a publish, which makes already-shipped fixes look
 * broken to the user.
 */
export function PwaUpdatePrompt() {
  const shownRef = useRef(false);

  useEffect(() => {
    function onUpdate(event: Event) {
      if (shownRef.current) return;
      shownRef.current = true;
      const worker = (event as CustomEvent<{ waiting: ServiceWorker | null }>).detail?.waiting;
      toast("A new version of Gradus is ready", {
        duration: Infinity,
        action: {
          label: "Refresh",
          onClick: () => {
            try {
              worker?.postMessage({ type: "SKIP_WAITING" });
            } catch {
              // ignore — reload below still picks up the new build
            }
            window.location.reload();
          },
        },
      });
    }

    window.addEventListener(SW_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(SW_UPDATE_EVENT, onUpdate);
  }, []);

  return null;
}
