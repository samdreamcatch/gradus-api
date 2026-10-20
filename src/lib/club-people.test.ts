import { describe, expect, it } from "bun:test";
import { coachPolicies } from "./club-people";

describe("coach policy evidence", () => {
  const doc = { resourceId: "policy", title: "Club policy", version: 2, dueAt: "2026-10-19T00:00:00Z" };
  const now = Date.parse("2026-10-20T00:00:00Z");
  it("only includes tasks assigned to this coach", () => {
    expect(coachPolicies("buddy", { docs: [doc], signers: { policy: [{ key: "coach:other", role: "coach", acknowledgedAt: null }] } }, now)).toEqual([]);
  });
  it("marks an unsigned task past its pack deadline overdue", () => {
    expect(coachPolicies("buddy", { docs: [doc], signers: { policy: [{ key: "coach:buddy", role: "coach", acknowledgedAt: null }] } }, now)[0]?.status).toBe("overdue");
  });
  it("signed evidence remains signed after the deadline", () => {
    expect(coachPolicies("buddy", { docs: [doc], signers: { policy: [{ key: "coach:buddy", role: "coach", acknowledgedAt: "2026-10-18T00:00:00Z" }] } }, now)[0]?.status).toBe("signed");
  });
});