import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "./use-auth-ready";

export type ViewerRole = "admin" | "coach" | "parent" | "athlete" | null;

/**
 * Which kind of Gradus account the signed-in viewer holds, resolved from the
 * same profile rows the login route checks. Returns `null` while loading and
 * for signed-out visitors — callers should also read `isReady`.
 */
export function useViewerRole(): { role: ViewerRole; isReady: boolean; signedIn: boolean } {
  const { user, isReady: authReady } = useAuthReady();

  const { data, isPending } = useQuery({
    queryKey: ["viewer-role", user?.id ?? "anon"],
    enabled: authReady && !!user,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ViewerRole> => {
      const uid = user!.id;
      const [admin, coach, parent, athlete] = await Promise.all([
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", uid)
          .eq("role", "admin")
          .maybeSingle(),
        supabase.from("coach_profiles").select("id").eq("user_id", uid).maybeSingle(),
        supabase.from("parent_profiles").select("id").eq("user_id", uid).maybeSingle(),
        supabase.from("athletes").select("id").eq("user_id", uid).limit(1).maybeSingle(),
      ]);

      if (admin.data) return "admin";
      if (coach.data) return "coach";
      if (parent.data) return "parent";
      if (athlete.data) return "athlete";
      return null;
    },
  });

  return {
    role: data ?? null,
    isReady: authReady && (!user || !isPending),
    signedIn: !!user,
  };
}
