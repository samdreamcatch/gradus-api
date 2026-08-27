/**
 * Optional Face ID / fingerprint gate for the native app.
 *
 * This is a local convenience lock, not an auth mechanism — the Supabase
 * session is still the source of truth. It only decides whether the app
 * content is revealed after a cold launch or a return from the background.
 */
import { isNativeApp } from "@/lib/native";

const PREF_KEY = "gradus.biometricLock";

export function isBiometricLockEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setBiometricLockEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(PREF_KEY, "1");
    else window.localStorage.removeItem(PREF_KEY);
  } catch {
    // ignore
  }
}

/** Whether this device has Face ID / Touch ID / fingerprint set up. */
export async function isBiometricAvailable(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { NativeBiometric } = await import("@capgo/capacitor-native-biometric");
    const result = await NativeBiometric.isAvailable();
    return result.isAvailable === true;
  } catch {
    return false;
  }
}

/**
 * Prompt for biometric verification. Resolves true when the user passes (or
 * when biometrics aren't available at all, so a device that loses its
 * enrollment can never lock someone out of their own account).
 */
export async function verifyBiometric(reason = "Unlock Gradus"): Promise<boolean> {
  if (!isNativeApp()) return true;
  try {
    const { NativeBiometric } = await import("@capgo/capacitor-native-biometric");
    const { isAvailable } = await NativeBiometric.isAvailable();
    if (!isAvailable) return true;
    await NativeBiometric.verifyIdentity({
      reason,
      title: "Gradus",
      subtitle: "Verify it's you",
      useFallback: true,
    });
    return true;
  } catch {
    return false;
  }
}
