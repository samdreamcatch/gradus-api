/**
 * Native push notification registration.
 *
 * Only ever runs inside the Capacitor shell. Web push is untouched — the PWA
 * path and this path never both run in the same runtime.
 */
import { isNativeApp, nativePlatform } from "@/lib/native";

export type PushPermission = "granted" | "denied" | "prompt" | "unsupported";

let currentToken: string | null = null;
let listenersBound = false;

/** The token registered in this session, if any. */
export function activePushToken(): string | null {
  return currentToken;
}

export async function pushPermissionState(): Promise<PushPermission> {
  if (!isNativeApp()) return "unsupported";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === "granted") return "granted";
    if (receive === "denied") return "denied";
    return "prompt";
  } catch {
    return "unsupported";
  }
}

/**
 * Ask for permission (if not already decided), register with APNs/FCM, and
 * hand the resulting token to the server. Resolves with the final permission
 * state so callers can render the right settings copy.
 *
 * `onToken` receives the device token; the caller owns persisting it so this
 * module stays free of server-function imports.
 */
export async function enableNativePush(
  onToken: (token: string, platform: "ios" | "android") => Promise<unknown>,
): Promise<PushPermission> {
  if (!isNativeApp()) return "unsupported";

  const { PushNotifications } = await import("@capacitor/push-notifications");

  let { receive } = await PushNotifications.checkPermissions();
  if (receive === "prompt" || receive === "prompt-with-rationale") {
    ({ receive } = await PushNotifications.requestPermissions());
  }
  if (receive !== "granted") return receive === "denied" ? "denied" : "prompt";

  const platform = nativePlatform();
  if (platform === "web") return "unsupported";

  if (!listenersBound) {
    listenersBound = true;

    await PushNotifications.addListener("registration", (t) => {
      currentToken = t.value;
      void onToken(t.value, platform);
    });

    await PushNotifications.addListener("registrationError", (err) => {
      console.warn("[push] registration failed", err);
    });

    // Tapping a notification deep-links into the relevant screen.
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const path = action.notification.data?.["path"];
      if (typeof path === "string" && path.startsWith("/")) window.location.assign(path);
    });
  }

  await PushNotifications.register();
  return "granted";
}

/** Stop receiving push on this device and forget the token locally. */
export async function disableNativePush(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.unregister();
  } catch {
    // ignore
  }
  currentToken = null;
}
