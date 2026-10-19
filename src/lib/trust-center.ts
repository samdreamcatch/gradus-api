/**
 * Club Trust Center readiness rules. Pure so they can be unit-tested; the
 * server gathers the inputs in trust-center.server.ts.
 */
export type ReadinessStatus = "ready" | "attention" | "blocked";

export type RequirementInput = {
  resourceId: string;
  title: string;
  sports: string[];
  dueAt: string | null;
  signers: { role: "coach" | "parent" | "athlete"; key: string; done: boolean }[];
};

export type ReadinessInput = {
  coachKeys: string[];
  requirements: RequirementInput[];
  minors: { linkedGuardian: boolean }[];
  expiredInvites: number;
  heldResources: number;
  now?: Date;
};

export type AttentionItem = {
  id: string;
  severity: Exclude<ReadinessStatus, "ready">;
  count: number;
  title: string;
  reason: string;
  to: string;
  search?: Record<string, string>;
};

export type Readiness = {
  status: ReadinessStatus;
  signOffPct: number | null;
  coachesReady: number;
  coachesTotal: number;
  familiesCoveredPct: number | null;
  items: AttentionItem[];
  bySport: { sport: string; done: number; total: number }[];
};

export function isOverdue(dueAt: string | null, now: Date): boolean {
  return !!dueAt && new Date(dueAt).getTime() < now.getTime();
}

export function computeReadiness(input: ReadinessInput): Readiness {
  const now = input.now ?? new Date();
  let done = 0;
  let total = 0;
  const coachMissing = new Set<string>();
  const sport = new Map<string, { done: number; total: number }>();
  const items: AttentionItem[] = [];

  for (const r of input.requirements) {
    const open = r.signers.filter((s) => !s.done);
    done += r.signers.length - open.length;
    total += r.signers.length;
    for (const s of open) if (s.role === "coach") coachMissing.add(s.key);
    for (const sp of r.sports) {
      const v = sport.get(sp) ?? { done: 0, total: 0 };
      v.done += r.signers.length - open.length;
      v.total += r.signers.length;
      sport.set(sp, v);
    }
    if (open.length) {
      const overdue = isOverdue(r.dueAt, now);
      items.push({
        id: `ack:${r.resourceId}`,
        severity: overdue ? "blocked" : "attention",
        count: open.length,
        title: `${open.length} still to sign "${r.title}"`,
        reason: overdue ? "Past the due date" : "Waiting on acknowledgement",
        to: "/org-admin/policies",
        search: { doc: r.resourceId },
      });
    }
  }

  const unlinked = input.minors.filter((m) => !m.linkedGuardian).length;
  if (unlinked) {
    items.push({
      id: "minors-unlinked",
      severity: "attention",
      count: unlinked,
      title: `${unlinked} under-18 athlete${unlinked === 1 ? "" : "s"} without a linked guardian`,
      reason: "Messages can't be mirrored to a parent account",
      to: "/org-admin/roster",
    });
  }
  if (input.expiredInvites) {
    items.push({
      id: "invites-expired",
      severity: "attention",
      count: input.expiredInvites,
      title: `${input.expiredInvites} coach invite${input.expiredInvites === 1 ? "" : "s"} expired`,
      reason: "Resend or revoke them",
      to: "/org-admin/roster",
    });
  }
  if (input.heldResources) {
    items.push({
      id: "resources-held",
      severity: "attention",
      count: input.heldResources,
      title: `${input.heldResources} club document${input.heldResources === 1 ? "" : "s"} waiting on review`,
      reason: "Members can't see it until it's released",
      to: "/org-admin/resources",
    });
  }

  items.sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "blocked" ? -1 : 1));
  const status: ReadinessStatus = items.some((i) => i.severity === "blocked")
    ? "blocked"
    : items.length
      ? "attention"
      : "ready";
  const coachesTotal = input.coachKeys.length;
  return {
    status,
    signOffPct: total ? Math.round((done / total) * 100) : null,
    coachesReady: input.coachKeys.filter((k) => !coachMissing.has(k)).length,
    coachesTotal,
    familiesCoveredPct: input.minors.length
      ? Math.round(((input.minors.length - unlinked) / input.minors.length) * 100)
      : null,
    items,
    bySport: [...sport.entries()]
      .map(([s, v]) => ({ sport: s, ...v }))
      .sort((a, b) => a.sport.localeCompare(b.sport)),
  };
}
