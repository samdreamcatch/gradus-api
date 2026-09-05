import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createApiRouteHandler } from "./define-route";
import { ApiError } from "./errors";
import type { ApiContext } from "./auth";

/**
 * Minimal in-memory Supabase-shaped fake for `.from(table).select().eq().eq()
 * .maybeSingle()`, `.update().eq()`, and `.upsert()` — the only shapes
 * idempotency.ts and rate-limit.ts use. Test-only; never shipped.
 */
function createFakeAdmin() {
  const store = new Map<string, Record<string, unknown>[]>();

  function rowsFor(table: string) {
    if (!store.has(table)) store.set(table, []);
    return store.get(table)!;
  }

  function builder(table: string, filters: Array<[string, unknown]>) {
    return {
      select(_columns?: string) {
        return builder(table, filters);
      },
      eq(column: string, value: unknown) {
        return builder(table, [...filters, [column, value]]);
      },
      async maybeSingle() {
        const match = rowsFor(table).find((row) => filters.every(([c, v]) => row[c] === v));
        return { data: match ?? null, error: null };
      },
      update(patch: Record<string, unknown>) {
        return {
          async eq(column: string, value: unknown) {
            for (const row of rowsFor(table)) {
              if (row[column] === value && filters.every(([c, v]) => row[c] === v)) {
                Object.assign(row, patch);
              }
            }
            return { data: null, error: null };
          },
        };
      },
    };
  }

  function from(table: string) {
    return {
      ...builder(table, []),
      async upsert(row: Record<string, unknown>, opts: { onConflict: string }) {
        const keys = opts.onConflict.split(",");
        const rows = rowsFor(table);
        const idx = rows.findIndex((r) => keys.every((k) => r[k] === row[k]));
        if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
        else rows.push({ ...row });
        return { data: null, error: null };
      },
    };
  }

  return { from } as unknown as ApiContext["admin"];
}

function makeRequest(init?: RequestInit): Request {
  return new Request("https://gradus.training/api/v1/test", init);
}

const outputSchema = z.object({ ok: z.boolean() });

describe("createApiRouteHandler", () => {
  it("returns 503 when the kill switch is off", async () => {
    delete process.env.API_V1_ENABLED;
    const { GET } = createApiRouteHandler(
      {
        method: "GET",
        path: "/api/v1/test",
        auth: "public",
        output: outputSchema,
        handler: async () => ({ ok: true }),
      },
      { admin: createFakeAdmin(), authenticate: async () => null },
    );

    const res = await GET!({ request: makeRequest() });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("api_disabled");
  });

  it("returns 401 for a user route with a missing bearer", async () => {
    process.env.API_V1_ENABLED = "true";
    const { GET } = createApiRouteHandler(
      {
        method: "GET",
        path: "/api/v1/test",
        auth: "user",
        output: outputSchema,
        handler: async () => ({ ok: true }),
      },
      { admin: createFakeAdmin(), authenticate: async () => null },
    );

    const res = await GET!({ request: makeRequest() });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });

  it("returns 401 for a user route with an invalid bearer", async () => {
    process.env.API_V1_ENABLED = "true";
    const { GET } = createApiRouteHandler(
      {
        method: "GET",
        path: "/api/v1/test",
        auth: "user",
        output: outputSchema,
        handler: async () => ({ ok: true }),
      },
      {
        admin: createFakeAdmin(),
        authenticate: async () => {
          throw ApiError.unauthenticated("Invalid token.");
        },
      },
    );

    const res = await GET!({ request: makeRequest({ headers: { authorization: "Bearer bad" } }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 with the error shape for bad input", async () => {
    process.env.API_V1_ENABLED = "true";
    const inputSchema = z.object({ name: z.string() });
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/test",
        auth: "public",
        input: inputSchema,
        output: outputSchema,
        handler: async () => ({ ok: true }),
      },
      { admin: createFakeAdmin(), authenticate: async () => null },
    );

    const res = await POST!({
      request: makeRequest({ method: "POST", body: JSON.stringify({}) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details).toBeDefined();
  });

  it("replays the stored idempotent response and calls the handler once", async () => {
    process.env.API_V1_ENABLED = "true";
    let calls = 0;
    const admin = createFakeAdmin();
    const ctx: ApiContext = { userId: "user-1", supabase: {} as ApiContext["supabase"], admin };
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/test",
        auth: "user",
        idempotent: true,
        output: outputSchema,
        handler: async () => {
          calls += 1;
          return { ok: true };
        },
      },
      { admin, authenticate: async () => ctx },
    );

    const req = () =>
      makeRequest({
        method: "POST",
        headers: { authorization: "Bearer t", "idempotency-key": "abc" },
      });

    const first = await POST!({ request: req() });
    const second = await POST!({ request: req() });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(calls).toBe(1);
  });

  it("returns 429 with Retry-After when the rate limit is exceeded", async () => {
    process.env.API_V1_ENABLED = "true";
    const admin = createFakeAdmin();
    const { GET } = createApiRouteHandler(
      {
        method: "GET",
        path: "/api/v1/test-rate-limit",
        auth: "public",
        output: outputSchema,
        rateLimit: { windowSeconds: 60, max: 1 },
        handler: async () => ({ ok: true }),
      },
      { admin, authenticate: async () => null },
    );

    const req = () => makeRequest({ headers: { "cf-connecting-ip": "1.2.3.4" } });
    const first = await GET!({ request: req() });
    const second = await GET!({ request: req() });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeTruthy();
    expect((await second.json()).error.code).toBe("rate_limited");
  });

  it("maps unknown errors to 500 without leaking the message", async () => {
    process.env.API_V1_ENABLED = "true";
    const { GET } = createApiRouteHandler(
      {
        method: "GET",
        path: "/api/v1/test",
        auth: "public",
        output: outputSchema,
        handler: async () => {
          throw new Error("column users.secret_column does not exist");
        },
      },
      { admin: createFakeAdmin(), authenticate: async () => null },
    );

    const res = await GET!({ request: makeRequest() });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal");
    expect(JSON.stringify(body)).not.toContain("secret_column");
  });
});

/** A fake whose rate-limit table is unreachable (as when a migration was never applied). */
function createBrokenRateLimitAdmin() {
  const healthy = createFakeAdmin() as unknown as { from: (table: string) => unknown };
  const missing = { code: "PGRST205", message: "relation public.api_rate_limits does not exist" };
  const failing: Record<string, unknown> = {};
  failing.select = () => failing;
  failing.eq = () => failing;
  failing.maybeSingle = async () => ({ data: null, error: missing });
  failing.update = () => ({ eq: async () => ({ data: null, error: missing }) });
  failing.upsert = async () => ({ data: null, error: missing });
  return {
    from: (table: string) => (table === "api_rate_limits" ? failing : healthy.from(table)),
  } as unknown as ApiContext["admin"];
}

describe("rate limiter degraded (table unreachable)", () => {
  const route = {
    path: "/api/v1/test",
    output: outputSchema,
    rateLimit: { windowSeconds: 60, max: 10 },
    handler: async () => ({ ok: true }),
  } as const;

  it("refuses public write routes with 503 rate_limiter_unavailable", async () => {
    process.env.API_V1_ENABLED = "true";
    const { POST } = createApiRouteHandler(
      { ...route, method: "POST", auth: "public" },
      { admin: createBrokenRateLimitAdmin(), authenticate: async () => null },
    );
    const res = await POST!({ request: makeRequest({ method: "POST" }) });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limiter_unavailable");
  });

  it("lets public reads through", async () => {
    process.env.API_V1_ENABLED = "true";
    const { GET } = createApiRouteHandler(
      { ...route, method: "GET", auth: "public" },
      { admin: createBrokenRateLimitAdmin(), authenticate: async () => null },
    );
    const res = await GET!({ request: makeRequest() });
    expect(res.status).toBe(200);
  });

  it("lets authenticated routes through", async () => {
    process.env.API_V1_ENABLED = "true";
    const admin = createBrokenRateLimitAdmin();
    const ctx = { userId: "user-1", supabase: {}, admin } as unknown as ApiContext;
    const { POST } = createApiRouteHandler(
      { ...route, method: "POST", auth: "user" },
      { admin, authenticate: async () => ctx },
    );
    const res = await POST!({
      request: makeRequest({ method: "POST", headers: { Authorization: "Bearer x" } }),
    });
    expect(res.status).toBe(200);
  });

  it("still enforces the limit when the table works", async () => {
    process.env.API_V1_ENABLED = "true";
    const admin = createFakeAdmin();
    const { POST } = createApiRouteHandler(
      { ...route, method: "POST", auth: "public", rateLimit: { windowSeconds: 60, max: 2 } },
      { admin, authenticate: async () => null },
    );
    const codes: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      codes.push((await POST!({ request: makeRequest({ method: "POST" }) })).status);
    }
    expect(codes).toEqual([200, 200, 429]);
  });
});
