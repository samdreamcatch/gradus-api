import { Suspense, lazy } from "react";
import { useInstallPrompt } from "@/pwa/use-install-prompt";

/**
 * The banner itself pulls in framer-motion (~125 KB). It only ever appears a
 * few seconds after load, and never at all for most sessions, so the visual
 * component is code-split and fetched the moment it's actually needed. The
 * install state lives in a module-level store, so reading it here and inside
 * the lazy banner sees the same values.
 */
const InstallBanner = lazy(() =>
  import("./install-banner").then((m) => ({ default: m.InstallBanner })),
);

export function InstallBannerMount() {
  const { status } = useInstallPrompt();
  if (status === "hidden") return null;
  return (
    <Suspense fallback={null}>
      <InstallBanner />
    </Suspense>
  );
}
