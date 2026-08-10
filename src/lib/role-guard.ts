import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { getMyRole } from "@/lib/parent-signup.functions";

export type AppRole = "coach" | "parent" | "athlete" | "org_admin";

export const myRoleQueryOptions = (userId?: string) =>
  queryOptions({
    // Scoped by user so one account's role can never be served to another
    // after an account switch.
    queryKey: ["my-role", userId ?? "anon"],
    queryFn: () => getMyRole(),
    staleTime: 60_000,
  });


const ROLE_HOME: Record<AppRole, string> = {
  coach: "/coach",
  parent: "/parent/plans",
  athlete: "/athlete/plans",
  org_admin: "/org-admin",
};

/**
 * beforeLoad gate for role-scoped subtrees. If the signed-in user isn't the
 * expected role, silently redirect to their own home instead of letting a
 * server-fn role check throw into the error boundary.
 */
export async function requireRole(expected: AppRole, queryClient: QueryClient, userId?: string) {
  let role: AppRole | null = null;
  try {
    const data = await queryClient.ensureQueryData(myRoleQueryOptions(userId));

    // The server may serialize null as an empty string over the wire, so
    // normalize it back to null before comparing.
    role = data.role ? (data.role as AppRole) : null;
  } catch {
    // If role lookup fails, don't block — let downstream loaders handle it.
    return;
  }
  if (!role || role === expected) return;
  const home = ROLE_HOME[role];
  if (!home) return;
  throw redirect({ to: home });
}
