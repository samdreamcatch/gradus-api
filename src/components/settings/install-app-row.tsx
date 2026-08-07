import { Download } from "lucide-react";
import { SettingsButtonRow } from "@/components/settings/primitives";
import { useInstallPrompt } from "@/pwa/use-install-prompt";

/**
 * Persistent "Install app" row for settings. Only renders when the app is
 * installable (Android/Chromium beforeinstallprompt captured) or on iOS
 * Safari (Add to Home Screen instructions). Hidden when already installed
 * or when the platform can't install a PWA.
 */
export function InstallAppRow() {
  const { platform, promptInstall, show } = useInstallPrompt();

  if (platform === "none") return null;

  const handleClick = () => {
    if (platform === "installable") {
      void promptInstall();
    } else {
      // iOS Safari — re-surface the Add to Home Screen instructions banner
      show();
    }
  };

  return (
    <SettingsButtonRow
      icon={<Download className="size-4" />}
      label="Install app"
      description={
        platform === "ios" ? "Add Gradus to your home screen" : "Get the full-screen app experience"
      }
      onClick={handleClick}
    />
  );
}
