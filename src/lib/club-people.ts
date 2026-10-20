export type CoachPolicy = {
  resourceId: string;
  title: string;
  version: number;
  dueAt: string | null;
  acknowledgedAt: string | null;
  status: "signed" | "outstanding" | "overdue";
};

export function coachPolicies(
  coachId: string,
  matrix: {
    docs: { resourceId: string; title: string; version: number; dueAt: string | null }[];
    signers: Record<string, { key: string; role: string; acknowledgedAt: string | null }[]>;
  },
  now = Date.now(),
): CoachPolicy[] {
  return matrix.docs.flatMap((doc) => {
    const signer = matrix.signers[doc.resourceId]?.find(
      (s) => s.role === "coach" && s.key === `coach:${coachId}`,
    );
    if (!signer) return [];
    return [{
      ...doc,
      acknowledgedAt: signer.acknowledgedAt,
      status: signer.acknowledgedAt ? "signed" as const
        : doc.dueAt && Date.parse(doc.dueAt) < now ? "overdue" as const : "outstanding" as const,
    }];
  });
}