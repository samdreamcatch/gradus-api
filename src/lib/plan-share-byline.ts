/**
 * The line above a shared plan's title. A plan an athlete wrote is "Plan by
 * Greta"; a coach's is "Plan by Coach Renata"; a Gradus plan with no coach
 * named is "Plan by Gradus" (never "Coach A Gradus coach"). A coach with only
 * a last name on file is still "Plan by Coach Pruitt". The fields arrive as
 * untyped RPC JSON, so each may be missing.
 */
export function sharedPlanByline(plan: {
  authorKind?: string;
  authorFirstName?: string | null;
  coachFirstName?: string | null;
  coachLastName?: string | null;
}): string {
  if (plan.authorKind === "athlete") return `Plan by ${plan.authorFirstName || "an athlete"}`;
  let first = (plan.coachFirstName ?? "").trim();
  if (first.toLowerCase() === "a gradus coach") first = "";
  const name = [first, (plan.coachLastName ?? "").trim()].filter(Boolean).join(" ");
  return name ? `Plan by Coach ${name}` : "Plan by Gradus";
}
