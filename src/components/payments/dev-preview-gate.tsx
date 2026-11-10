import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { isDevToolsHost } from "@/components/dev/preview-host";

export function DevPreviewGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV || isDevToolsHost(window.location.hostname)) {
      setAllowed(true);
    } else {
      void navigate({ to: "/" });
    }
  }, [navigate]);

  return allowed ? children : null;
}
