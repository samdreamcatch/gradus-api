import { describe, expect, it } from "bun:test";
import {
  athleteDraftSummarySchema,
  athletePlanSummarySchema,
  athletePlansSchema,
  parentPlanSummarySchema,
  planDetailSchema,
  sharedPlanSchema,
} from "./plans-schema";

const counts = { frustrated: 0, pushing: 0, steady: 0, lockedIn: 0, flowing: 0 };

describe("athlete-authored plans on the wire", () => {
  it("every new field is optional: a response from a server that predates them still decodes", () => {
    const summary = {
      id: "p",
      title: "t",
      status: "active",
      coachId: "",
      coachName: "Gradus",
      isGradus: true,
      sport: "",
      moveCount: 0,
      totalMinutes: 0,
      updatedAt: "2026-10-05T00:00:00Z",
      sessionsByState: counts,
      sessionsTotal: 0,
    };
    expect(athletePlanSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      athletePlansSchema.safeParse({ athlete: { id: "a", firstName: "E" }, plans: [summary] })
        .success,
    ).toBe(true);
    expect(
      sharedPlanSchema.safeParse({
        title: "t",
        notes: "",
        coachFirstName: "Renata",
        coachLastName: "Pruitt",
        sharedAt: null,
        moves: [],
      }).success,
    ).toBe(true);
    expect(
      parentPlanSummarySchema.safeParse({
        id: "p",
        title: "t",
        status: "benched",
        athleteId: "a",
        athleteName: "E",
        coachId: "",
        coachName: "Gradus",
        isGradus: true,
        moveCount: 0,
        totalMinutes: 0,
        updatedAt: "x",
        sessionsByState: counts,
        sessionsTotal: 0,
      }).success,
    ).toBe(true);
  });

  it("carries the author on a shared plan and the source on summaries", () => {
    const shared = sharedPlanSchema.parse({
      title: "t",
      notes: "",
      coachFirstName: "",
      coachLastName: "",
      sharedAt: null,
      moves: [],
      authorKind: "athlete",
      authorFirstName: "Elsie",
    });
    expect(shared.authorKind).toBe("athlete");
    expect(shared.authorFirstName).toBe("Elsie");
    expect(
      athletePlanSummarySchema.parse({
        id: "p",
        title: "t",
        status: "benched",
        coachId: "",
        coachName: "Elsie",
        isGradus: false,
        sport: "",
        moveCount: 1,
        totalMinutes: 5,
        updatedAt: "x",
        sessionsByState: counts,
        sessionsTotal: 0,
        source: "athlete",
      }).source,
    ).toBe("athlete");
  });

  it("never widens a closed enum: a draft is its own type, not a new status value", () => {
    expect(athletePlanSummarySchema.shape.status.options).toEqual(["active", "benched"]);
    expect(
      athletePlanSummarySchema.safeParse({
        id: "p",
        title: "t",
        status: "draft",
        coachId: "",
        coachName: "",
        isGradus: false,
        sport: "",
        moveCount: 0,
        totalMinutes: 0,
        updatedAt: "x",
        sessionsByState: counts,
        sessionsTotal: 0,
      }).success,
    ).toBe(false);
    expect(
      athleteDraftSummarySchema.safeParse({
        id: "p",
        title: "t",
        status: "draft",
        source: "athlete",
        moveCount: 0,
        totalMinutes: 0,
        updatedAt: "x",
      }).success,
    ).toBe(true);
  });

  it("the role-aware detail keeps its old shape and gains optional source and author", () => {
    const base = {
      id: "p",
      title: "t",
      notes: "",
      kind: "plan",
      status: "draft",
      athleteId: "a",
      athleteName: null,
      athleteFirstName: "Elsie",
      coach: null,
      viewerRole: "athlete",
      isOwner: true,
      moveCount: 0,
      totalMinutes: 0,
      updatedAt: "x",
      moves: [],
      voiceTranscript: null,
      sessionsByState: counts,
      sessionsTotal: 0,
    };
    expect(planDetailSchema.safeParse(base).success).toBe(true);
    expect(
      planDetailSchema.parse({ ...base, source: "athlete", authorFirstName: "Elsie" }).source,
    ).toBe("athlete");
  });
});
