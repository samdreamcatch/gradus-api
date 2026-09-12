import { describe, expect, it } from "bun:test";
import {
  APP_RECOVERY_REDIRECT_URL,
  RECOVERY_REDIRECT_URL,
  recoverRoute,
  recoveryRedirectUrl,
} from "./auth-recover-route";
import type { ApiContext } from "./auth";
import { createApiRouteHandler } from "./define-route";

/** In-memory fake for the rate limiter's `api_rate_limits` reads and writes (see define-route.test.ts). */
function createFakeAdmin() {
  const store = new Map<string, Record<string, unknown>[]>();
  const rowsFor = (table: string) => {
    if (!store.has(table)) store.set(table, []);
    return store.get(table)!;
  };
  function builder(table: string, filters: Array<[string, unknown]>) {
    return {
      select: () => builder(table, filters),
      eq: (column: string, value: unknown) => builder(table, [...filters, [column, value]]),
      async maybeSingle() {
        const match = rowsFor(table).find((row) => filters.every(([c, v]) => row[c] === v));
        return { data: match ?? null, error: null };
      },
      update: (patch: Record<string, unknown>) => ({
        async eq(column: string, value: unknown) {
          for (const row of rowsFor(table)) {
            if (row[column] === value) Object.assign(row, patch);
          }
          return { data: null, error: null };
        },
      }),
    };
  }
  return {
    from: (table: string) => ({
      ...builder(table, []),
      async upsert(row: Record<string, unknown>, opts: { onConflict: string }) {
        const keys = opts.onConflict.split(",");
        const rows = rowsFor(table);
        const idx = rows.findIndex((r) => keys.every((k) => r[k] === row[k]));
        if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
        else rows.push({ ...row });
        return { data: null, error: null };
      },
    }),
  } as unknown as ApiContext["admin"];
}

type GoTrueCall = { path: string; body: Record<string, unknown> };

function setup(goTrueOutcome: { ok: boolean; status: number } = { ok: true, status: 200 }) {
  process.env.API_V1_ENABLED = "true";
  const admin = createFakeAdmin();
  const calls: GoTrueCall[] = [];
  const { POST } = createApiRouteHandler(
    recoverRoute({
      goTrue: async (path, body) => {
        calls.push({ path, body });
        return goTrueOutcome.ok
          ? { ok: true, status: goTrueOutcome.status, data: null, error: null }
          : {
              ok: false,
              status: goTrueOutcome.status,
              data: null,
              error: { msg: "User not found" },
            };
      },
    }),
    { admin, authenticate: async () => null },
  );
  const request = (body?: string, ip = "203.0.113.7") =>
    new Request("https://gradus.training/api/v1/auth/recover", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body,
    });
  return { POST: POST!, request, calls };
}

const redirectParam = (path: string) =>
  new URL(`https://example.invalid/${path}`).searchParams.get("redirect_to");

describe("recoveryRedirectUrl", () => {
  it("maps omitted and web to the web page and app to the gradus scheme", () => {
    expect(recoveryRedirectUrl(undefined)).toBe(RECOVERY_REDIRECT_URL);
    expect(recoveryRedirectUrl("web")).toBe(RECOVERY_REDIRECT_URL);
    expect(recoveryRedirectUrl("app")).toBe(APP_RECOVERY_REDIRECT_URL);
    expect(RECOVERY_REDIRECT_URL).toBe("https://gradus.training/reset-password");
    expect(APP_RECOVERY_REDIRECT_URL).toBe("gradus://reset-password");
  });
});

describe("POST /api/v1/auth/recover", () => {
  it("sends the web reset page as redirect_to when client is omitted (today's behaviour)", async () => {
    const { POST, request, calls } = setup();
    const res = await POST({ request: request(JSON.stringify({ email: "dana@example.com" })) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe(
      `recover?redirect_to=${encodeURIComponent("https://gradus.training/reset-password")}`,
    );
    expect(redirectParam(calls[0].path)).toBe("https://gradus.training/reset-password");
    expect(calls[0].body).toEqual({ email: "dana@example.com" });
  });

  it("sends the same web redirect for client 'web'", async () => {
    const { POST, request, calls } = setup();
    const res = await POST({
      request: request(JSON.stringify({ email: "dana@example.com", client: "web" })),
    });
    expect(res.status).toBe(200);
    expect(redirectParam(calls[0].path)).toBe("https://gradus.training/reset-password");
  });

  it("sends the gradus scheme as redirect_to for client 'app'", async () => {
    const { POST, request, calls } = setup();
    const res = await POST({
      request: request(JSON.stringify({ email: "dana@example.com", client: "app" })),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls[0].path).toBe(
      `recover?redirect_to=${encodeURIComponent("gradus://reset-password")}`,
    );
    expect(redirectParam(calls[0].path)).toBe("gradus://reset-password");
    // The body never carries the client flag or anything but the email.
    expect(calls[0].body).toEqual({ email: "dana@example.com" });
  });

  it("still answers 200 { ok: true } for an unknown email (anti-enumeration)", async () => {
    const { POST, request, calls } = setup({ ok: false, status: 404 });
    const res = await POST({
      request: request(JSON.stringify({ email: "nobody@example.com", client: "app" })),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it("rejects an unknown client value with 400 validation_failed and never calls GoTrue", async () => {
    const { POST, request, calls } = setup();
    const res = await POST({
      request: request(
        JSON.stringify({ email: "dana@example.com", client: "https://evil.example" }),
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation_failed");
    expect(calls).toEqual([]);
  });

  it("rejects a malformed email with 400 validation_failed and never calls GoTrue", async () => {
    const { POST, request, calls } = setup();
    const res = await POST({ request: request(JSON.stringify({ email: "not-an-email" })) });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("keeps the per-IP limiter at 10 per minute (SMOKE.md probe: ten 200s then 429)", async () => {
    const { POST, request } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await POST({ request: request(JSON.stringify({ email: "dana@example.com" })) });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 429, 429]);
  });
});
