import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Three-state auth hook: while `isReady` is false the session is still
 * hydrating from storage and callers must NOT redirect. Once `isReady` is
 * true, `user` is the confirmed session user (or null if signed out).
 */
export function useAuthReady() {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;

    // This hook is only for client-side readiness, so use the local session
    // snapshot instead of a network round-trip. The actual protected route
    // gate still verifies identity before rendering protected screens.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUser(data.session?.user ?? null);
      setIsReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return { user, isReady };
}
