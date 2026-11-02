import { describe, expect, it } from "bun:test";
import { computeReadiness } from "./trust-center";

const now = new Date("2026-10-19T12:00:00Z");
const req = (dueAt: string | null, done: boolean[]) => ({
  resourceId: "r1",
  title: "Safe Sport",
  sports: ["golf"],
  dueAt,
  signers: done.map((d, i) => ({ role: "coach" as const, key: `c${i}`, done: d })),
});

describe("computeReadiness", () => {
  it("is ready when everything is signed and covered", () => {
    const r = computeReadiness({
      coachKeys: ["c0", "c1"],
      requirements: [req(null, [true, true])],
      minors: [{ linkedGuardian: true }],
      expiredInvites: 0,
      heldResources: 0,
      now,
    });
    expect(r.status).toBe("ready");
    expect(r.signOffPct).toBe(100);
    expect(r.coachesReady).toBe(2);
    expect(r.familiesCoveredPct).toBe(100);
  });

  it("needs attention when signatures are outstanding before the due date", () => {
    const r = computeReadiness({
      coachKeys: ["c0", "c1", "c2", "c3"],
      requirements: [req("2026-11-01T00:00:00Z", [true, false, false, true])],
      minors: [],
      expiredInvites: 0,
      heldResources: 0,
      now,
    });
    expect(r.status).toBe("attention");
    expect(r.signOffPct).toBe(50);
    expect(r.coachesReady).toBe(2);
    expect(r.items[0]?.count).toBe(2);
  });

  it("is blocked when a requirement is past its due date", () => {
    const r = computeReadiness({
      coachKeys: ["c0"],
      requirements: [req("2026-10-01T00:00:00Z", [false])],
      minors: [],
      expiredInvites: 0,
      heldResources: 0,
      now,
    });
    expect(r.status).toBe("blocked");
  });

  it("counts minors without a linked guardian", () => {
    const r = computeReadiness({
      coachKeys: [],
      requirements: [],
      minors: [
        { linkedGuardian: true },
        { linkedGuardian: false },
        { linkedGuardian: false },
        { linkedGuardian: true },
      ],
      expiredInvites: 2,
      heldResources: 0,
      now,
    });
    expect(r.familiesCoveredPct).toBe(50);
    expect(r.items.map((i) => i.id)).toEqual(["minors-unlinked", "invites-expired"]);
  });
});
