import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "gradus.sampleAthleteDismissed";
const EVENT = "gradus:sample-athlete-dismissed";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function write(value: boolean) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — keep in-memory state only */
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Whether the coach has permanently dismissed the sample athlete on this
 * device. Read after hydration so SSR and the first client render agree.
 */
export function useSampleAthleteDismissed() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(read());
    const sync = () => setDismissed(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const dismiss = useCallback(() => write(true), []);
  const restore = useCallback(() => write(false), []);

  return { dismissed, dismiss, restore };
}
