import { describe, expect, it } from "bun:test";
import { appliesToSelf, matchesPolicyAcknowledgement, policyDeadline } from "./club-policy";
import { computeReadiness } from "./trust-center";

describe("club policy rules", () => {
  it("uses the earliest deadline from active packs for the document", () => {
    expect(policyDeadline("safe-sport", [
      { resourceIds: ["safe-sport"], dueAt: "2026-11-01T00:00:00Z" },
      { resourceIds: ["safe-sport"], dueAt: "2026-10-21T00:00:00Z" },
      { resourceIds: ["travel"], dueAt: "2026-10-01T00:00:00Z" },
    ])).toBe("2026-10-21T00:00:00Z");
  });
  it("ignores archived pack deadlines", () => {
    expect(policyDeadline("safe-sport", [{ resourceIds: ["safe-sport"], dueAt: "2026-10-01T00:00:00Z", archivedAt: "2026-10-02T00:00:00Z" }])).toBeNull();
  });
  it("blocks only outstanding sign-offs past the deadline", () => {
    const input = { coachKeys: ["coach:1"], minors: [], expiredInvites: 0, heldResources: 0, now: new Date("2026-10-20T12:00:00Z") };
    const requirement = { resourceId: "safe-sport", title: "Safe Sport", sports: ["golf"], dueAt: "2026-10-19T12:00:00Z", signers: [{ role: "coach" as const, key: "coach:1", done: false }] };
    expect(computeReadiness({ ...input, requirements: [requirement] }).status).toBe("blocked");
    expect(computeReadiness({ ...input, requirements: [{ ...requirement, signers: [{ ...requirement.signers[0], role: "coach", key: "coach:1", done: true }] }] }).status).toBe("ready");
  });
  const ack = { organization_id: "club-a", resource_id: "safe-sport", version: 2, user_id: "parent-1", acted_for_athlete_id: "minor-1" };
  const target = { organizationId: "club-a", resourceId: "safe-sport", version: 2, userId: "parent-1", forAthleteId: "minor-1" };
  it("never counts another club's sign-off", () => {
    expect(matchesPolicyAcknowledgement(ack, { ...target, organizationId: "club-b" })).toBe(false);
  });
  it("keeps earlier version evidence separate from current sign-offs", () => {
    expect(matchesPolicyAcknowledgement(ack, { ...target, version: 3 })).toBe(false);
  });
  it("attributes guardian sign-offs to the represented athlete, not the parent's own task", () => {
    expect(matchesPolicyAcknowledgement(ack, target)).toBe(true);
    expect(matchesPolicyAcknowledgement(ack, { ...target, forAthleteId: null })).toBe(false);
    expect(matchesPolicyAcknowledgement(ack, { ...target, forAthleteId: "minor-2" })).toBe(false);
  });
  it("requires guardians rather than under-18 athletes to sign", () => {
    expect(appliesToSelf("athlete", true, ["athlete"])).toBe(false);
    expect(appliesToSelf("athlete", false, ["athlete"])).toBe(true);
    expect(appliesToSelf("parent", false, ["parent"])).toBe(true);
  });
});