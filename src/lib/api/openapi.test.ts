import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { buildOpenApiDocument, deriveOperationId, pathParamsSchema, registerApiRoute } from "./openapi";

describe("deriveOperationId", () => {
  it("derives stable camelCase ids from method and path", () => {
    expect(deriveOperationId("get", "/api/v1/meta/config")).toBe("getMetaConfig");
    expect(deriveOperationId("post", "/api/v1/auth/username/check")).toBe("postAuthUsernameCheck");
    expect(deriveOperationId("get", "/api/v1/me/")).toBe("getMe");
  });

  it("turns path parameters into By<Name> segments", () => {
    expect(deriveOperationId("get", "/api/v1/public/boards/{slug}")).toBe("getPublicBoardsBySlug");
    expect(deriveOperationId("delete", "/api/v1/devices/{token}")).toBe("deleteDevicesByToken");
  });

  it("handles hyphenated and underscored segments", () => {
    expect(deriveOperationId("get", "/api/v1/meta/client-policy")).toBe("getMetaClientPolicy");
    expect(deriveOperationId("post", "/api/v1/live_activities/tokens")).toBe(
      "postLiveActivitiesTokens",
    );
  });
});

describe("registerApiRoute", () => {
  const output = z.object({ ok: z.boolean() });

  it("rejects two routes that derive the same operationId", () => {
    registerApiRoute({
      method: "post",
      path: "/api/v1/zz-test/terms",
      summary: "a",
      auth: "public",
      output,
    });
    expect(() =>
      registerApiRoute({
        method: "post",
        path: "/api/v1/zz-test-terms",
        summary: "b",
        auth: "public",
        output,
      }),
    ).toThrow(/duplicate operationId "postZzTestTerms"/);
  });

  it("allows the same route to register again (dev reloads)", () => {
    registerApiRoute({
      method: "get",
      path: "/api/v1/zz-test/again",
      summary: "a",
      auth: "public",
      output,
    });
    expect(() =>
      registerApiRoute({
        method: "get",
        path: "/api/v1/zz-test/again",
        summary: "a",
        auth: "public",
        output,
      }),
    ).not.toThrow();
  });
});

describe("pathParamsSchema", () => {
  it("declares every templated segment as a required string", () => {
    expect(pathParamsSchema("/api/v1/meta/config")).toBeUndefined();
    const schema = pathParamsSchema("/api/v1/boards/{slug}/follows/{name}")!;
    expect(schema.parse({ slug: "a", name: "b" })).toEqual({ slug: "a", name: "b" });
    expect(() => schema.parse({ slug: "a" })).toThrow();
  });
});

describe("query parameters", () => {
  it("declares each query field as a query parameter", () => {
    registerApiRoute({
      method: "get",
      path: "/api/v1/zz-test/paged",
      summary: "paged",
      auth: "user",
      query: z.object({ limit: z.coerce.number().optional(), cursor: z.string().optional() }),
      output: z.object({ ok: z.boolean() }),
    });
    const doc = buildOpenApiDocument() as {
      paths: Record<string, { get: { parameters?: { name: string; in: string; required?: boolean }[] } }>;
    };
    const params = doc.paths["/api/v1/zz-test/paged"].get.parameters ?? [];
    expect(params.map((p) => [p.name, p.in, !!p.required])).toEqual([
      ["limit", "query", false],
      ["cursor", "query", false],
    ]);
  });
});

