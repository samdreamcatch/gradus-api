export type ClubSetupCounts = {
  coaches: number;
  lessons: number;
  publishedResources: number;
  policyRequirements: number;
};

export function clubSetupSteps(counts: ClubSetupCounts) {
  return [
    { key: "coaches", title: "Invite coaches", to: "/org-admin/roster" as const, done: counts.coaches > 0 },
    { key: "schedule", title: "Add the lesson schedule", to: "/org-admin/schedule" as const, done: counts.lessons > 0 },
    { key: "resources", title: "Publish club resources", to: "/org-admin/resources" as const, done: counts.publishedResources > 0 },
    { key: "policies", title: "Set policy acknowledgements", to: "/org-admin/policies" as const, done: counts.policyRequirements > 0 },
  ];
}