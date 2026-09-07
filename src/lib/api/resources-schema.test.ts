import { describe, expect, it } from "bun:test";
import { roleAwareResourcesSchema } from "./resources-schema";

describe("roleAwareResourcesSchema", () => {
  it("is a discriminated union on `role`, not a plain union", () => {
    // zod-to-openapi only emits a tagged `oneOf` + `discriminator` for
    // ZodDiscriminatedUnion; a plain ZodUnion renders as an untagged `anyOf`
    // in the generated OpenAPI doc (and Swift client). Guards against this
    // schema silently reverting to `z.union([...])`.
    expect(roleAwareResourcesSchema._def.typeName).toBe("ZodDiscriminatedUnion");
  });

  it("parses each role's shape and preserves its `role` tag", () => {
    const coach = roleAwareResourcesSchema.parse({
      role: "coach",
      sports: [],
      resources: [],
      libraryResources: [],
      canUpload: false,
      effectiveTier: "coach",
    });
    expect(coach.role).toBe("coach");

    const parent = roleAwareResourcesSchema.parse({
      role: "parent",
      sports: [],
      resources: [],
    });
    expect(parent.role).toBe("parent");

    const athlete = roleAwareResourcesSchema.parse({
      role: "athlete",
      sports: [],
      resources: [],
    });
    expect(athlete.role).toBe("athlete");
  });

  it("rejects a role tag that doesn't match any branch", () => {
    expect(() =>
      roleAwareResourcesSchema.parse({ role: "org_admin", sports: [], resources: [] }),
    ).toThrow();
  });
});
