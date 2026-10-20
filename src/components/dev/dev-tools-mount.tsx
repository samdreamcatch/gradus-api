import { Suspense, lazy, useEffect, useState } from "react";
import { isDevToolsHost } from "./preview-host";

// Code-split: the dev panel never renders on production hosts, so its code
// shouldn't sit in the main bundle that every phone downloads.
const DevTools = lazy(() => import("./dev-tools").then((m) => ({ default: m.DevTools })));

// In local dev (`vite dev`), `import.meta.env.DEV` is true and we always
// mount DevTools. In the Lovable preview build, Vite runs in production
// mode so DEV is false — but we still want the DEV button on the
// main/draft `id-preview[-N]--*.lovable.app` and `*.lovableproject.com` hosts. We do NOT
// want it on the published custom domain or `*.lovable.app` production URL.
//
// Hostname check runs on the client only to keep SSR output deterministic.
function PreviewOnlyDevTools() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(isDevToolsHost(window.location.hostname));
  }, []);
  if (!show) return null;
  return (
    <Suspense fallback={null}>
      <DevTools />
    </Suspense>
  );
}

// Always use the hydrated gate. Branching on the build environment here can
// make the SSR tree differ from the browser's first render in hosted preview.
export const DevToolsMount = PreviewOnlyDevTools;
