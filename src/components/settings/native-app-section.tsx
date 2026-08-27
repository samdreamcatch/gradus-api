import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Fingerprint } from "lucide-react";
import { toast } from "sonner";
import { SettingsRow } from "@/components/settings/primitives";
import { Switch } from "@/components/ui/switch";
import { isNativeApp } from "@/lib/native";
import {
  disableNativePush,
  enableNativePush,
  activePushToken,
  pushPermissionState,
  type PushPermission,
} from "@/lib/native-push";
import {
  isBiometricAvailable,
  isBiometricLockEnabled,
  setBiometricLockEnabled,
  verifyBiometric,
} from "@/lib/native-biometric";
import { registerDeviceToken, unregisterDeviceToken } from "@/lib/push.functions";

/**
 * Device-level settings that only exist inside the installed iOS/Android app.
 * Renders nothing on the web, so every settings screen can mount it safely.
 */
export function NativeAppSection() {
  const [native, setNative] = useState(false);
  const [perm, setPerm] = useState<PushPermission>("unsupported");
  const [pushBusy, setPushBusy] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);

  const register = useServerFn(registerDeviceToken);
  const unregister = useServerFn(unregisterDeviceToken);

  useEffect(() => {
    if (!isNativeApp()) return;
    setNative(true);
    setBioOn(isBiometricLockEnabled());
    void pushPermissionState().then(setPerm);
    void isBiometricAvailable().then(setBioAvailable);
  }, []);

  if (!native) return null;

  const pushOn = perm === "granted";

  const togglePush = async (next: boolean) => {
    setPushBusy(true);
    try {
      if (next) {
        const state = await enableNativePush(async (token, platform) => {
          await register({ data: { token, platform } });
        });
        setPerm(state);
        if (state === "denied") {
          toast.error("Notifications are off for Gradus", {
            description: "Turn them on in your phone's Settings app.",
          });
        }
      } else {
        const token = activePushToken();
        await disableNativePush();
        if (token) await unregister({ data: { token } }).catch(() => undefined);
        setPerm("prompt");
      }
    } catch {
      toast.error("Couldn't update notifications");
    } finally {
      setPushBusy(false);
    }
  };

  const toggleBio = async (next: boolean) => {
    if (next) {
      const ok = await verifyBiometric("Turn on unlock for Gradus");
      if (!ok) {
        toast.error("Couldn't verify — unlock stays off");
        return;
      }
    }
    setBiometricLockEnabled(next);
    setBioOn(next);
  };

  return (
    <>
      <SettingsRow
        icon={<Bell className="size-4" />}
        label="Push notifications"
        description={
          perm === "denied"
            ? "Blocked — enable Gradus notifications in your phone settings"
            : "Messages, new plans, and practice reminders"
        }
        trailing={
          <Switch
            checked={pushOn}
            disabled={pushBusy || perm === "denied"}
            onCheckedChange={(v) => void togglePush(v)}
            aria-label="Push notifications"
          />
        }
      />
      {bioAvailable ? (
        <SettingsRow
          icon={<Fingerprint className="size-4" />}
          label="Unlock with Face ID"
          description="Require a face or fingerprint check when opening the app"
          trailing={
            <Switch
              checked={bioOn}
              onCheckedChange={(v) => void toggleBio(v)}
              aria-label="Unlock with Face ID"
            />
          }
        />
      ) : null}
    </>
  );
}
