import { describe, expect, it } from "bun:test";
import type { ErrorLogInput } from "./error-tracking.server";
import { reportAppError } from "./errors.server";

function capture() {
  const calls: ErrorLogInput[] = [];
  return {
    calls,
    log: async (input: ErrorLogInput) => {
      calls.push(input);
      return { id: "row" };
    },
  };
}

describe("reportAppError", () => {
  it("tags the row as iOS with version, build, and the caller", async () => {
    const c = capture();
    const result = await reportAppError(
      { userId: "user-1", userAgent: "Gradus/1.0.0 iOS", host: "gradus.training", log: c.log },
      {
        message: "Plan link expired",
        kind: "error",
        appVersion: "1.0.0",
        build: "42",
        route: "plan/abc",
      },
    );
    expect(result).toEqual({ ok: true });
    expect(c.calls.length).toBe(1);
    const row = c.calls[0];
    expect(row.source).toBe("client");
    expect(row.message).toBe("Plan link expired");
    expect(row.userId).toBe("user-1");
    expect(row.route).toBe("plan/abc");
    expect(row.environment).toBe("production");
    expect(row.metadata?.platform).toBe("ios");
    expect(row.metadata?.appVersion).toBe("1.0.0");
    expect(row.metadata?.build).toBe("42");
    expect(row.metadata?.kind).toBe("error");
  });

  it("prefixes crashes and hangs, keeps caller metadata, and detects preview hosts", async () => {
    const c = capture();
    await reportAppError(
      { userId: null, userAgent: null, host: "id-preview--abc.lovable.app", log: c.log },
      {
        message: "EXC_BAD_ACCESS in BoardSession",
        kind: "crash",
        appVersion: "1.0.0",
        build: "43",
        osVersion: "26.3.1",
        device: "iPhone18,2",
        occurredAt: "2026-09-19T15:00:00Z",
        metadata: { thread: "main" },
      },
    );
    const row = c.calls[0];
    expect(row.message).toBe("[crash] EXC_BAD_ACCESS in BoardSession");
    expect(row.userId).toBeNull();
    expect(row.environment).toBe("preview");
    expect(row.metadata?.thread).toBe("main");
    expect(row.metadata?.osVersion).toBe("26.3.1");
    expect(row.metadata?.device).toBe("iPhone18,2");
    expect(row.metadata?.occurredAt).toBe("2026-09-19T15:00:00Z");
  });

  it("takes the platform from X-Gradus-Client (S-4)", async () => {
    const c = capture();
    await reportAppError(
      {
        userId: "user-2",
        userAgent: "okhttp/5.0",
        host: "gradus.training",
        clientPlatform: "android",
        log: c.log,
      },
      { message: "Sync failed", kind: "hang", appVersion: "1.0.0", build: "1" },
    );
    expect(c.calls[0].metadata?.platform).toBe("android");
    expect(c.calls[0].message).toBe("[hang] Sync failed");
  });

  it("prefers the header over the body, and the body over the iOS default", async () => {
    const c = capture();
    const deps = (clientPlatform: string | null) => ({
      userId: null,
      userAgent: null,
      host: "gradus.training",
      clientPlatform,
      log: c.log,
    });
    const base = { message: "x", kind: "error" as const, appVersion: "1.0.0", build: "1" };
    await reportAppError(deps("wearos"), { ...base, platform: "android" });
    await reportAppError(deps(null), { ...base, platform: "android" });
    await reportAppError(deps("toaster"), base);
    await reportAppError(deps("WATCHOS"), base);
    expect(c.calls.map((r) => r.metadata?.platform)).toEqual([
      "wearos",
      "android",
      "ios",
      "watchos",
    ]);
  });
});
