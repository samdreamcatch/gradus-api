import { useEffect, useId, useRef } from "react";

/**
 * Public site key. Safe to expose in client bundles (Turnstile's site key is
 * public by design; the secret key lives server-side only).
 */
export const TURNSTILE_SITE_KEY =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "";

const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

function getEffectiveSiteKey() {
  if (typeof window === "undefined") return TURNSTILE_SITE_KEY;
  const hostname = window.location.hostname;
  const isPreviewHost =
    hostname === "localhost" ||
    hostname.endsWith(".lovable.app") ||
    hostname.endsWith(".lovableproject.com") ||
    hostname.endsWith(".vercel.app");

  return isPreviewHost ? TURNSTILE_TEST_SITE_KEY : TURNSTILE_SITE_KEY;
}

type TurnstileTheme = "auto" | "light" | "dark";

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  theme?: TurnstileTheme;
  action?: string;
  /** Force remount to reset the widget (change the key when you want a new challenge). */
  resetKey?: string | number;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: TurnstileTheme;
          action?: string;
          size?: "normal" | "flexible" | "compact";
          appearance?: "always" | "execute" | "interaction-only";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    __turnstileScriptLoading?: Promise<void>;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (window.__turnstileScriptLoading) return window.__turnstileScriptLoading;

  window.__turnstileScriptLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Turnstile failed to load")));
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    // Without this, any throw inside Turnstile reaches window.onerror as an
    // opaque "Script error." with no file/line. CORS-enabled loading keeps the
    // real message and stack.
    s.crossOrigin = "anonymous";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(s);
  });
  return window.__turnstileScriptLoading;
}

export function TurnstileWidget({
  onVerify,
  onExpire,
  onError,
  theme = "auto",
  action,
  resetKey,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const lastTokenRef = useRef<string | null>(null);
  const id = useId();

  useEffect(() => {
    const siteKey = getEffectiveSiteKey();
    if (!siteKey) {
      // Fail open in local/dev when the key isn't configured yet; the server
      // fn will still reject unless a valid token arrives.
      console.warn("Turnstile site key missing (VITE_TURNSTILE_SITE_KEY)");
      return;
    }
    let cancelled = false;
    let observer: MutationObserver | null = null;
    let fallbackTimer: number | null = null;

    const verifyFromHiddenResponse = () => {
      const token = containerRef.current?.querySelector<HTMLInputElement>(
        'input[name="cf-turnstile-response"]',
      )?.value;

      if (token && token !== lastTokenRef.current) {
        lastTokenRef.current = token;
        onVerify(token);
      }
    };

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => {
            lastTokenRef.current = token;
            onVerify(token);
          },
          "expired-callback": () => onExpire?.(),
          "error-callback": () => onError?.(),
          theme,
          action,
          appearance: "interaction-only",
          size: "flexible",
        });

        observer = new MutationObserver(verifyFromHiddenResponse);
        observer.observe(containerRef.current, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["value"],
        });
        fallbackTimer = window.setInterval(verifyFromHiddenResponse, 250);
        verifyFromHiddenResponse();
      })
      .catch(() => onError?.());

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
      }
      observer?.disconnect();
      if (fallbackTimer) window.clearInterval(fallbackTimer);
      widgetIdRef.current = null;
      lastTokenRef.current = null;
    };
    // resetKey forces a fresh render for a new challenge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return <div ref={containerRef} id={`turnstile-${id}`} className="min-h-[2px]" />;
}
