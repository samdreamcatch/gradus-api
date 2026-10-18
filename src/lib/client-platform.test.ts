import { describe, expect, it } from "bun:test";
import {
  clientPlatformLabel,
  digestPlatformPrefix,
  resolveClientPlatform,
} from "./client-platform";

describe("resolveClientPlatform", () => {
  it("uses a known header platform, case-insensitively", () => {
    expect(resolveClientPlatform("android")).toBe("android");
    expect(resolveClientPlatform("WearOS")).toBe("wearos");
    expect(resolveClientPlatform("ios", "android")).toBe("ios");
  });

  it("falls back to the body, then to iOS", () => {
    expect(resolveClientPlatform(null, "android")).toBe("android");
    expect(resolveClientPlatform("web", "wearos")).toBe("wearos");
    expect(resolveClientPlatform(undefined)).toBe("ios");
    expect(resolveClientPlatform("web", null)).toBe("ios");
  });
});

describe("clientPlatformLabel", () => {
  it("names each app and leaves web rows unlabeled", () => {
    expect(clientPlatformLabel("ios")).toBe("iOS");
    expect(clientPlatformLabel("watchos")).toBe("watchOS");
    expect(clientPlatformLabel("android")).toBe("Android");
    expect(clientPlatformLabel("wearos")).toBe("Wear OS");
    expect(clientPlatformLabel(null)).toBeNull();
    expect(clientPlatformLabel("web")).toBeNull();
  });
});

describe("digestPlatformPrefix", () => {
  it("prefixes app rows only (S-4)", () => {
    expect(digestPlatformPrefix("ios")).toBe("[iOS] ");
    expect(digestPlatformPrefix("android")).toBe("[Android] ");
    expect(digestPlatformPrefix(null)).toBe("");
  });
});
