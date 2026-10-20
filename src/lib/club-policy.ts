export type DeadlinePack = {
  dueAt: string | null;
  resourceIds: string[];
  archivedAt?: string | null;
};

export function policyDeadline(resourceId: string, packs: DeadlinePack[]): string | null {
  const dates = packs
    .filter((p) => !p.archivedAt && p.resourceIds.includes(resourceId))
    .map((p) => p.dueAt)
    .filter((d): d is string => !!d && Number.isFinite(Date.parse(d)));
  dates.sort((a, b) => Date.parse(a) - Date.parse(b));
  return dates[0] ?? null;
}

export function matchesPolicyAcknowledgement(
  ack: { organization_id: string; resource_id: string; version: number; user_id: string; acted_for_athlete_id: string | null },
  target: { organizationId: string; resourceId: string; version: number; userId: string; forAthleteId: string | null },
): boolean {
  return ack.organization_id === target.organizationId &&
    ack.resource_id === target.resourceId && ack.version === target.version &&
    (target.forAthleteId
      ? ack.acted_for_athlete_id === target.forAthleteId
      : ack.user_id === target.userId && !ack.acted_for_athlete_id);
}

export function appliesToSelf(role: string, isMinor: boolean | undefined, audiences: string[]): boolean {
  return audiences.includes(role) && !(role === "athlete" && isMinor);
}

export function isClubPolicyResource(
  resource: { organization_id: string | null; coach_id: string | null; is_org_template: boolean; published: boolean; review_state: string; sport: string },
  orgId: string,
  sports: string[],
  archived: boolean,
): boolean {
  if (resource.coach_id || resource.review_state !== "released" || archived) return false;
  return (resource.organization_id === orgId && resource.is_org_template) ||
    (resource.organization_id === null && resource.published && sports.includes(resource.sport));
}