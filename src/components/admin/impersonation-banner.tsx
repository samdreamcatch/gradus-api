import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { clearImpersonating, readImpersonating } from "@/lib/impersonation";

/**
 * Sticky banner shown while an admin is signed in as another user.
 * Ending the session signs out entirely and returns to the login screen.
 */
export function ImpersonationBanner() {
  const [email, setEmail] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    setEmail(readImpersonating()?.email ?? null);
  }, []);

  if (!email) return null;

  const end = async () => {
    clearImpersonating();
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-divider bg-accent px-4 py-2 text-accent-foreground">
      <p className="min-w-0 truncate text-xs font-mono uppercase tracking-wide">
        Viewing as {email}
      </p>
      <button
        onClick={end}
        className="press shrink-0 rounded-pill border border-accent-foreground/40 px-3 py-1 text-xs font-semibold"
      >
        End session
      </button>
    </div>
  );
}
