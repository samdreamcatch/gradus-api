import { describe, expect, it } from "bun:test";
import { computeParentChecklist, parentChecklistSteps } from "./parent-checklist.functions";

/**
 * A chainable fake: `rows[table]` answers `maybeSingle`; `lists[table]`
 * answers awaited selects. `queried` records which tables were read.
 */
function fakeAdmin(
  rows: Record<string, unknown | null>,
  lists: Record<string, unknown[]> = {},
  queried: string[] = [],
) {
  const chain = (table: string) => {
    queried.push(table);
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) self[m] = () => self;
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: lists[table] ?? [], error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

const KWS_ENV = {
  PARENT_VERIFICATION_REQUIRED: "true",
  KWS_CLIENT_ID: "client",
  KWS_API_KEY: "key",
  KWS_API_HOST: "https://kws.example",
  KWS_WEBHOOK_SECRET: "secret",
} as NodeJS.ProcessEnv;

const NO_KWS_ENV = { PARENT_VERIFICATION_REQUIRED: "false" } as NodeJS.ProcessEnv;

const unverifiedParent = {
  id: "parent-1",
  user_id: "user-1",
  coach_id: null,
  adult_verified_at: null,
  adult_verification_method: null,
  adult_verification_requested_at: null,
};

describe("computeParentChecklist", () => {
  it("is empty without a parent profile", async () => {
    const result = await computeParentChecklist(fakeAdmin({}), "user-1", KWS_ENV);
    expect(result).toEqual({
      parentId: null,
      verifyApplies: false,
      verifyDone: false,
      coachDone: false,
      athleteCount: 0,
      goalsDone: false,
    });
  });

  it("starts a brand-new parent at nothing done, with the verify step when KWS is on", async () => {
    const queried: string[] = [];
    const result = await computeParentChecklist(
      fakeAdmin({ parent_profiles: unverifiedParent }, {}, queried),
      "user-1",
      KWS_ENV,
    );
    expect(result).toEqual({
      parentId: "parent-1",
      verifyApplies: true,
      verifyDone: false,
      coachDone: false,
      athleteCount: 0,
      goalsDone: false,
    });
    // No athletes: no link or goal lookups.
    expect(queried).toEqual(["parent_profiles", "athletes"]);
    expect(parentChecklistSteps(result).map((s) => s.key)).toEqual(["verify", "coach", "goals"]);
  });

  it("leaves the verify step out where KWS is not configured", async () => {
    const result = await computeParentChecklist(
      fakeAdmin({ parent_profiles: unverifiedParent }),
      "user-1",
      NO_KWS_ENV,
    );
    expect(result.verifyApplies).toBe(false);
    expect(parentChecklistSteps(result).map((s) => s.key)).toEqual(["coach", "goals"]);
  });

  it("ticks verify for a KWS-verified parent and coach for a linked athlete", async () => {
    const result = await computeParentChecklist(
      fakeAdmin(
        {
          parent_profiles: {
            ...unverifiedParent,
            adult_verified_at: "2026-10-01T00:00:00Z",
            adult_verification_method: "kws",
          },
        },
        {
          athletes: [{ id: "athlete-1" }],
          coach_athletes: [{ athlete_id: "athlete-1" }],
          athlete_goals: [],
        },
      ),
      "user-1",
      KWS_ENV,
    );
    expect(result).toEqual({
      parentId: "parent-1",
      verifyApplies: true,
      verifyDone: true,
      coachDone: true,
      athleteCount: 1,
      goalsDone: false,
    });
  });

  it("counts a legacy sign-up coach link and goals on file", async () => {
    const result = await computeParentChecklist(
      fakeAdmin(
        {
          parent_profiles: {
            ...unverifiedParent,
            coach_id: "coach-1",
            adult_verified_at: "2026-01-01T00:00:00Z",
            adult_verification_method: "legacy",
          },
        },
        {
          athletes: [{ id: "athlete-1" }, { id: "athlete-2" }],
          athlete_goals: [{ athlete_id: "athlete-2" }],
        },
      ),
      "user-1",
      KWS_ENV,
    );
    expect(result.coachDone).toBe(true);
    expect(result.athleteCount).toBe(2);
    expect(result.goalsDone).toBe(true);
    expect(result.verifyDone).toBe(true);
    expect(parentChecklistSteps(result).every((s) => s.done)).toBe(true);
  });
});
