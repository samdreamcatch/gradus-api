import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { getMyRole } from "@/lib/parent-signup.functions";

export type AppRole = "coach" | "parent" | "athlete";

export const myRoleQueryOptions = queryOptions({
  queryKey: ["my-role"],
  queryFn: () => getMyRole(),
  staleTime: 60_000,
});

const ROLE_HOME: Record<AppRole, string> = {
  coach: "/coach",
  parent: "/parent/plans",
  athlete: "/athlete/plans",
};

/**
 * beforeLoad gate for role-scoped subtrees. If the signed-in user isn't the
 * expected role, silently redirect to their own home instead of letting a
 * server-fn role check throw into the error boundary.
 */
export async function requireRole(expected: AppRole, queryClient: QueryClient) {
  let role: AppRole | null = null;
  try {
    const data = await queryClient.ensureQueryData(myRoleQueryOptions);
    role = data.role;
  } catch {
    // If role lookup fails, don't block — let downstream loaders handle it.
    return;
  }
  if (!role || role === expected) return;
  throw redirect({ to: ROLE_HOME[role] });
}
