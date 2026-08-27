import { useCallback, useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNativeApp } from "@/lib/native";
import { isBiometricLockEnabled, verifyBiometric } from "@/lib/native-biometric";

/**
 * Full-screen cover shown on cold launch (and after a long time in the
 * background) when the user has turned on biometric unlock. Renders nothing
 * on the web and nothing when the setting is off, so it never blocks anyone
 * who hasn't opted in.
 */
const RELOCK_AFTER_MS = 5 * 60 * 1000;

export function BiometricGate() {
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(false);

  const unlock = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    const ok = await verifyBiometric();
    setChecking(false);
    if (ok) setLocked(false);
  }, [checking]);

  useEffect(() => {
    if (!isNativeApp() || !isBiometricLockEnabled()) return;
    setLocked(true);
    void unlock();

    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS && isBiometricLockEnabled()) {
        setLocked(true);
        void unlock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // `unlock` is stable enough for this one-shot setup; re-running would
    // re-prompt on every keystroke-driven render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!locked) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <Fingerprint className="size-10 text-text-tertiary" aria-hidden />
      <p className="text-sm text-text-secondary">Gradus is locked</p>
      <Button type="button" onClick={() => void unlock()} disabled={checking}>
        {checking ? "Checking…" : "Unlock"}
      </Button>
    </div>
  );
}
