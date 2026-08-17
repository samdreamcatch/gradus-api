import { useEffect, useState } from "react";
import { DevTools } from "./dev-tools";

// In local dev (`vite dev`), `import.meta.env.DEV` is true and we always
// mount DevTools. In the Lovable preview build, Vite runs in production
// mode so DEV is false — but we still want the DEV button on the
// `id-preview--*.lovable.app` and `*.lovableproject.com` hosts. We do NOT
// want it on the published custom domain or `*.lovable.app` production URL.
//
// Hostname check runs on the client only to keep SSR output deterministic.
function PreviewOnlyDevTools() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const host = window.location.hostname;
    const isPreview =
      host.startsWith("id-preview--") ||
      host.endsWith(".lovableproject.com") ||
      host === "localhost" ||
      host === "127.0.0.1";
    if (isPreview) setShow(true);
  }, []);
  if (!show) return null;
  return <DevTools />;
}

// Always use the hydrated gate. Branching on the build environment here can
// make the SSR tree differ from the browser's first render in hosted preview.
export const DevToolsMount = PreviewOnlyDevTools;
