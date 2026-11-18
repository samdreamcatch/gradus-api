import { describe, expect, it } from "bun:test";
import { appSchemeUrl, isIOSDevice } from "./open-in-app";

describe("appSchemeUrl", () => {
  it("maps a site path to the app's custom scheme", () => {
    expect(appSchemeUrl("/p/abc123")).toBe("gradus://p/abc123");
    expect(appSchemeUrl("marketplace")).toBe("gradus://marketplace");
  });
});

describe("isIOSDevice", () => {
  it("detects iPhone and iPadOS, not desktop Mac or Android", () => {
    expect(isIOSDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(isIOSDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isIOSDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isIOSDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe(false);
  });
});
