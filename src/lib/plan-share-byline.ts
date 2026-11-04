/**
 * The line above a shared plan's title. A plan an athlete wrote is "Plan by
 * Greta"; a coach's is "Plan by Coach Renata"; a Gradus plan with no coach
 * named is "Plan by Gradus" (never "Coach A Gradus coach").
 */
export function sharedPlanByline(plan: {
  authorKind?: string;
  authorFirstName?: string;
  coachFirstName: string;
  coachLastName: string;
}): string {
  if (plan.authorKind === "athlete") return `Plan by ${plan.authorFirstName ?? "an athlete"}`;
  const first = plan.coachFirstName.trim();
  if (!first || first.toLowerCase() === "a gradus coach") return "Plan by Gradus";
  return `Plan by Coach ${[first, plan.coachLastName.trim()].filter(Boolean).join(" ")}`;
}
