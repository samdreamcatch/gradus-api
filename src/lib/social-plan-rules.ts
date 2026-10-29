export function isAdminSocialPlan(plan: {
  kind: string;
  source: string;
  coach_id: string | null;
  athlete_id: string | null;
  share_token: string | null;
}) {
  return plan.kind === "template" && plan.source === "gradus" &&
    plan.coach_id === null && plan.athlete_id === null && Boolean(plan.share_token);
}