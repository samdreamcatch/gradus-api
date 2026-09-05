import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { deriveOperationId, registerApiRoute } from "./openapi";

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
