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

    // Use getUser() rather than getSession(): getUser() round-trips to the
    // auth server and cryptographically verifies the JWT, so a forged
    // localStorage session can't bypass the route gate. getSession() only
    // reads from storage.
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUser(data.user ?? null);
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
