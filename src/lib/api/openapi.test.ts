import { describe, expect, it } from "bun:test";
import { deriveOperationId } from "./openapi";

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
