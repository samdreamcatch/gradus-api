import { describe, expect, it } from "bun:test";
import {
  registerDeviceToken,
  registerDeviceTokenInput,
  unregisterDeviceToken,
  unregisterDeviceTokenInput,
} from "./push.server";

type Call = {
  op: "upsert" | "delete";
  payload?: unknown;
  opts?: unknown;
  filters: [string, unknown][];
};

/** A minimal fake for device_tokens: records the write and its chained filters; upsert/delete resolve to `{ error: null }`. */
function fakeClient(error: { message: string } | null = null) {
  const calls: Call[] = [];
  const chain = (op: Call["op"], payload?: unknown, opts?: unknown) => {
    const filters: [string, unknown][] = [];
    const call: Call = { op, payload, opts, filters };
    calls.push(call);
    const self: Record<string, unknown> = {
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return self;
      },
      then: (resolve: (v: unknown) => void) => resolve({ error }),
    };
    return self;
  };
  const supabase = {
    from: () => ({
      upsert: (payload: unknown, opts: unknown) => chain("upsert", payload, opts),
      delete: () => chain("delete"),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { supabase, calls };
}

describe("registerDeviceToken", () => {
  it("upserts on the token, scoped to the caller, with the platform and a fresh last_seen_at", async () => {
    const { supabase, calls } = fakeClient();
    const before = Date.now();
    const result = await registerDeviceToken(
      { userId: "u1", supabase },
      { token: "apns-token-abc123", platform: "ios" },
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe("upsert");
    expect(calls[0].opts).toEqual({ onConflict: "token" });
    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload.user_id).toBe("u1");
    expect(payload.token).toBe("apns-token-abc123");
    expect(payload.platform).toBe("ios");
    expect(new Date(payload.last_seen_at as string).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("surfaces a generic message on a database error, not the raw one", async () => {
    const { supabase } = fakeClient({ message: "duplicate key value" });
    await expect(
      registerDeviceToken(
        { userId: "u1", supabase },
        { token: "apns-token-abc123", platform: "ios" },
      ),
    ).rejects.toThrow("Couldn't register this device for notifications.");
  });
});

describe("unregisterDeviceToken", () => {
  it("deletes scoped to both the token and the caller", async () => {
    const { supabase, calls } = fakeClient();
    const result = await unregisterDeviceToken({ userId: "u1", supabase }, "apns-token-abc123");
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        op: "delete",
        payload: undefined,
        opts: undefined,
        filters: [
          ["token", "apns-token-abc123"],
          ["user_id", "u1"],
        ],
      },
    ]);
  });

  it("is still ok when nothing matched (already removed, or never registered)", async () => {
    const { supabase } = fakeClient();
    await expect(
      unregisterDeviceToken({ userId: "u1", supabase }, "unknown-token"),
    ).resolves.toEqual({
      ok: true,
    });
  });
});

describe("input schemas", () => {
  it("registerDeviceTokenInput requires a real platform and a token of reasonable length", () => {
    expect(registerDeviceTokenInput.safeParse({ token: "short", platform: "ios" }).success).toBe(
      false,
    );
    expect(
      registerDeviceTokenInput.safeParse({ token: "a".repeat(9), platform: "windows" }).success,
    ).toBe(false);
    expect(
      registerDeviceTokenInput.safeParse({ token: "a".repeat(9), platform: "android" }).success,
    ).toBe(true);
  });

  it("unregisterDeviceTokenInput requires a token of reasonable length", () => {
    expect(unregisterDeviceTokenInput.safeParse({ token: "short" }).success).toBe(false);
    expect(unregisterDeviceTokenInput.safeParse({ token: "a".repeat(9) }).success).toBe(true);
  });
});
