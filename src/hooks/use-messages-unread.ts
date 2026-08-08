import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUnreadTotal } from "@/lib/messages.functions";
import { useAuthReady } from "./use-auth-ready";

/**
 * Subscribes to message inserts/reads and returns the current user's
 * total unread message count for the bottom-nav badge.
 */
export function useMessagesUnread(): number {
  const fetchTotal = useServerFn(getUnreadTotal);
  const queryClient = useQueryClient();
  const { user, isReady } = useAuthReady();

  const { data } = useQuery({
    queryKey: ["messages-unread-total"],
    queryFn: () => fetchTotal(),
    refetchOnWindowFocus: true,
    enabled: isReady && !!user,
  });

  useEffect(() => {
    const channel = supabase
      .channel("messages-unread")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        queryClient.invalidateQueries({ queryKey: ["messages-unread-total"] });
        queryClient.invalidateQueries({ queryKey: ["message-rooms"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return data?.total ?? 0;
}
