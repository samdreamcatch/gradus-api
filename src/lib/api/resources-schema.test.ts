import { describe, expect, it } from "bun:test";
import { roleAwareResourcesSchema } from "./resources-schema";

describe("roleAwareResourcesSchema", () => {
  it("is a plain object with three named, nullable payload fields — not a union", () => {
    // A ZodDiscriminatedUnion parses cleanly and produces the right `oneOf`
    // JSON Schema, but zod-to-openapi never emits the OpenAPI `discriminator`
    // keyword for it, so swift-openapi-generator falls back to an unlabeled
    // case1/case2/case3 enum instead of named cases. Three named nullable
    // fields decode cleanly on every generator with nothing version-specific
    // to rely on. Guards against reverting to z.discriminatedUnion/z.union.
    expect(roleAwareResourcesSchema._def.typeName).toBe("ZodObject");
    expect(Object.keys(roleAwareResourcesSchema.shape).sort()).toEqual([
      "athlete",
      "coach",
      "parent",
      "role",
    ]);
  });

  it("parses each role's payload with the other two fields null", () => {
    const coach = roleAwareResourcesSchema.parse({
      role: "coach",
      coach: {
        sports: [],
        resources: [],
        libraryResources: [],
        canUpload: false,
        effectiveTier: "coach",
      },
      parent: null,
      athlete: null,
    });
    expect(coach.role).toBe("coach");
    expect(coach.coach?.effectiveTier).toBe("coach");
    expect(coach.parent).toBeNull();
    expect(coach.athlete).toBeNull();

    const parent = roleAwareResourcesSchema.parse({
      role: "parent",
      coach: null,
      parent: { sports: [], resources: [] },
      athlete: null,
    });
    expect(parent.role).toBe("parent");
    expect(parent.parent).toEqual({ sports: [], resources: [] });

    const athlete = roleAwareResourcesSchema.parse({
      role: "athlete",
      coach: null,
      parent: null,
      athlete: { sports: [], resources: [] },
    });
    expect(athlete.role).toBe("athlete");
    expect(athlete.athlete).toEqual({ sports: [], resources: [] });
  });

  it("rejects a role tag outside the three known roles", () => {
    expect(() =>
      roleAwareResourcesSchema.parse({
        role: "org_admin",
        coach: null,
        parent: null,
        athlete: null,
      }),
    ).toThrow();
  });

  it("requires all three payload fields to be present (as null when unused)", () => {
    expect(() => roleAwareResourcesSchema.parse({ role: "parent", parent: null })).toThrow();
  });
});
