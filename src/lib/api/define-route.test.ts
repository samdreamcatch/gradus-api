import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createApiRouteHandler, ifNoneMatchMatches, weakETag } from "./define-route";
import { ApiError } from "./errors";
import { runWithRequestContext } from "@/lib/background";
import type { ApiContext } from "./auth";

/**
 * Minimal in-memory Supabase-shaped fake for `.from(table).select().eq()
 * .maybeSingle()`, `.update().eq()`, and `.upsert()` — the shapes
 * rate-limit.ts uses — plus `.rpc()` simulating the three
 * `*_idempotency_key` Postgres functions idempotency.ts calls (see
 * supabase/migrations/20260908030000_idempotency_key_reservation.sql for
 * the real ones this mirrors). Test-only; never shipped.
 */
function createFakeAdmin() {
  const store = new Map<string, Record<string, unknown>[]>();
  const idempotencyKeys = new Map<string, Record<string, unknown>>();

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

  async function rpc(fn: string, params: Record<string, unknown>) {
    const rowKey = `${params._user_id}::${params._key}`;
    if (fn === "reserve_idempotency_key") {
      const now = Date.now();
      const existing = idempotencyKeys.get(rowKey);
      if (!existing) {
        idempotencyKeys.set(rowKey, {
          request_hash: params._request_hash,
          response_status: null,
          response_body: null,
          created_at: new Date(now).toISOString(),
        });
        return {
          data: [{ state: "reserved", response_status: null, response_body: null }],
          error: null,
        };
      }
      const ageSeconds = (now - new Date(existing.created_at as string).getTime()) / 1000;
      const expired =
        existing.response_status != null
          ? ageSeconds > (params._replay_window_seconds as number)
          : ageSeconds > (params._pending_timeout_seconds as number);
      if (expired) {
        Object.assign(existing, {
          request_hash: params._request_hash,
          response_status: null,
          response_body: null,
          created_at: new Date(now).toISOString(),
        });
        return {
          data: [{ state: "reserved", response_status: null, response_body: null }],
          error: null,
        };
      }
      if (existing.response_status == null) {
        return {
          data: [{ state: "in_progress", response_status: null, response_body: null }],
          error: null,
        };
      }
      if (existing.request_hash !== params._request_hash) {
        return {
          data: [{ state: "key_reused", response_status: null, response_body: null }],
          error: null,
        };
      }
      return {
        data: [
          {
            state: "replay",
            response_status: existing.response_status,
            response_body: existing.response_body,
          },
        ],
        error: null,
      };
    }
    if (fn === "complete_idempotency_key") {
      const row = idempotencyKeys.get(rowKey);
      if (row) {
        row.response_status = params._response_status;
        row.response_body = params._response_body;
      }
      return { data: null, error: null };
    }
    if (fn === "release_idempotency_key") {
      const row = idempotencyKeys.get(rowKey);
      if (row && row.response_status == null) idempotencyKeys.delete(rowKey);
      return { data: null, error: null };
    }
    return { data: null, error: { message: `unknown rpc: ${fn}` } };
  }

  return { from, rpc } as unknown as ApiContext["admin"];
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

  it("stores only the shaped body for replay when idempotencyStoredBody is set, and still answers the first call in full", async () => {
    process.env.API_V1_ENABLED = "true";
    const words = { words: z.string(), id: z.string() };
    const fakeAdmin = createFakeAdmin();
    const stored: unknown[] = [];
    const admin = {
      ...fakeAdmin,
      rpc: async (fn: string, params: Record<string, unknown>) => {
        if (fn === "complete_idempotency_key") stored.push(params._response_body);
        return (fakeAdmin as unknown as { rpc: (f: string, p: unknown) => Promise<unknown> }).rpc(
          fn,
          params,
        );
      },
    } as unknown as ApiContext["admin"];
    const ctx: ApiContext = { userId: "user-1", supabase: {} as ApiContext["supabase"], admin };
    let calls = 0;
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/test",
        auth: "user",
        idempotent: true,
        idempotencyStoredBody: (out) => ({ ...out, words: "" }),
        output: z.object(words),
        handler: async () => {
          calls += 1;
          return { id: "plan-1", words: "my secret words" };
        },
      },
      { admin, authenticate: async () => ctx },
    );
    const req = () =>
      makeRequest({
        method: "POST",
        headers: { authorization: "Bearer t", "idempotency-key": "voice-1" },
      });

    const first = await (await POST!({ request: req() })).json();
    const replay = await (await POST!({ request: req() })).json();

    expect(first).toEqual({ id: "plan-1", words: "my secret words" });
    expect(replay).toEqual({ id: "plan-1", words: "" });
    expect(JSON.stringify(stored)).not.toContain("secret");
    expect(calls).toBe(1);
  });

  it("rejects a concurrent duplicate with the same Idempotency-Key instead of also running the handler", async () => {
    process.env.API_V1_ENABLED = "true";
    let calls = 0;
    const admin = createFakeAdmin();
    const ctx: ApiContext = { userId: "user-1", supabase: {} as ApiContext["supabase"], admin };
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/test",
        auth: "user",
        idempotent: true,
        output: outputSchema,
        handler: async () => {
          calls += 1;
          await gate;
          return { ok: true };
        },
      },
      { admin, authenticate: async () => ctx },
    );

    const req = () =>
      makeRequest({
        method: "POST",
        headers: { authorization: "Bearer t", "idempotency-key": "concurrent-1" },
      });

    const firstPromise = POST!({ request: req() });
    // Give the first call's reservation a tick to land before firing the second.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await POST!({ request: req() });
    releaseFirst();
    const first = await firstPromise;

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("idempotency_key_in_progress");
    expect(calls).toBe(1);
  });

  it("rejects the same Idempotency-Key reused with a different request body", async () => {
    process.env.API_V1_ENABLED = "true";
    let calls = 0;
    const admin = createFakeAdmin();
    const ctx: ApiContext = { userId: "user-1", supabase: {} as ApiContext["supabase"], admin };
    const inputSchema = z.object({ amountCents: z.number() });
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/test",
        auth: "user",
        idempotent: true,
        input: inputSchema,
        output: outputSchema,
        handler: async () => {
          calls += 1;
          return { ok: true };
        },
      },
      { admin, authenticate: async () => ctx },
    );

    const req = (amountCents: number) =>
      makeRequest({
        method: "POST",
        headers: {
          authorization: "Bearer t",
          "idempotency-key": "reused-1",
          "content-type": "application/json",
        },
        body: JSON.stringify({ amountCents }),
      });

    const first = await POST!({ request: req(5000) });
    const second = await POST!({ request: req(20000) });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("idempotency_key_reused");
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

describe("Server-Timing", () => {
  /** A fake admin whose every database call moves the fake clock forward. */
  function timedAdmin(clock: { t: number }, costs: { rpc: number; table: number }) {
    const admin = createFakeAdmin() as unknown as {
      from: (table: string) => unknown;
      rpc: (fn: string, params: Record<string, unknown>) => Promise<unknown>;
    };
    return {
      from(table: string) {
        clock.t += costs.table;
        return admin.from(table);
      },
      async rpc(fn: string, params: Record<string, unknown>) {
        clock.t += costs.rpc;
        return admin.rpc(fn, params);
      },
    } as unknown as ApiContext["admin"];
  }

  it("reports the wait in each phase of an idempotent, rate-limited POST", async () => {
    process.env.API_V1_ENABLED = "true";
    const clock = { t: 5_000 };
    const admin = timedAdmin(clock, { rpc: 40, table: 25 });
    const ctx: ApiContext = { userId: "user-1", supabase: {} as ApiContext["supabase"], admin };
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/test",
        auth: "user",
        idempotent: true,
        rateLimit: { windowSeconds: 60, max: 10 },
        input: z.object({ name: z.string() }),
        output: outputSchema,
        handler: async () => {
          clock.t += 230;
          return { ok: true };
        },
      },
      {
        admin,
        authenticate: async () => {
          clock.t += 12;
          return ctx;
        },
        now: () => clock.t,
        wasCold: async () => false,
      },
    );

    const res = await POST!({
      request: makeRequest({
        method: "POST",
        headers: { authorization: "Bearer t", "idempotency-key": "timing-1" },
        body: JSON.stringify({ name: "x" }),
      }),
    });

    expect(res.status).toBe(200);
    // idem is the reserve and complete calls (40 + 40), not the handler inside them.
    expect(res.headers.get("server-timing")).toBe(
      "auth;dur=12, ratelimit;dur=25, body;dur=0, idem;dur=80, handler;dur=230, total;dur=347",
    );
  });

  it("is sent on errors too, and marks a request that waited for a new server instance", async () => {
    process.env.API_V1_ENABLED = "true";
    const clock = { t: 0 };
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
          clock.t += 7;
          return null;
        },
        now: () => clock.t,
        wasCold: async () => true,
      },
    );

    const res = await GET!({ request: makeRequest() });
    expect(res.status).toBe(401);
    expect(res.headers.get("server-timing")).toBe("auth;dur=7, total;dur=7, cold");
  });

  it("on a replay lists the reserve call and no handler; a failed handler counts its release", async () => {
    process.env.API_V1_ENABLED = "true";
    const clock = { t: 0 };
    const admin = timedAdmin(clock, { rpc: 40, table: 25 });
    const ctx: ApiContext = { userId: "user-1", supabase: {} as ApiContext["supabase"], admin };
    let fail = false;
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/test",
        auth: "user",
        idempotent: true,
        output: outputSchema,
        handler: async () => {
          clock.t += 100;
          if (fail) throw new ApiError({ code: "conflict", status: 409, message: "No." });
          return { ok: true };
        },
      },
      { admin, authenticate: async () => ctx, now: () => clock.t, wasCold: async () => false },
    );
    const send = (key?: string) =>
      POST!({
        request: makeRequest({
          method: "POST",
          headers: { authorization: "Bearer t", ...(key ? { "idempotency-key": key } : {}) },
        }),
      });

    const first = await send("replay-1");
    expect(first.headers.get("server-timing")).toBe(
      "auth;dur=0, body;dur=0, idem;dur=80, handler;dur=100, total;dur=180",
    );
    const replay = await send("replay-1");
    expect(replay.status).toBe(200);
    expect(replay.headers.get("server-timing")).toBe(
      "auth;dur=0, body;dur=0, idem;dur=40, total;dur=40",
    );

    fail = true;
    const refused = await send("fails-1");
    expect(refused.status).toBe(409);
    // reserve + release around a handler that took 100.
    expect(refused.headers.get("server-timing")).toBe(
      "auth;dur=0, body;dur=0, idem;dur=80, handler;dur=100, total;dur=180",
    );

    // No Idempotency-Key: nothing was reserved, so no idem phase is listed.
    fail = false;
    const unkeyed = await send();
    expect(unkeyed.headers.get("server-timing")).toBe(
      "auth;dur=0, body;dur=0, handler;dur=100, total;dur=100",
    );
  });

  it("is left off public writes, which answer alike for a known and an unknown account", async () => {
    process.env.API_V1_ENABLED = "true";
    const clock = { t: 0 };
    const make = (method: "GET" | "POST") =>
      createApiRouteHandler(
        {
          method,
          path: "/api/v1/auth/recover",
          auth: "public",
          output: outputSchema,
          handler: async () => {
            clock.t += 3_500;
            return { ok: true };
          },
        },
        {
          admin: createFakeAdmin(),
          authenticate: async () => null,
          now: () => clock.t,
          wasCold: async () => true,
        },
      );

    const lines: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void lines.push(args);
    let post: Response;
    let get: Response;
    try {
      post = await make("POST").POST!({ request: makeRequest({ method: "POST" }) });
      get = await make("GET").GET!({ request: makeRequest() });
    } finally {
      console.warn = original;
    }

    expect(post.status).toBe(200);
    expect(post.headers.get("server-timing")).toBeNull();
    expect(get.headers.get("server-timing")).toBe(
      "auth;dur=0, handler;dur=3500, total;dur=3500, cold",
    );
    // The server's own log still records both.
    expect(lines).toHaveLength(2);
  });

  it("reads the cold mark from the request scope the Worker entry sets", async () => {
    process.env.API_V1_ENABLED = "true";
    const { GET } = createApiRouteHandler(
      {
        method: "GET",
        path: "/api/v1/test",
        auth: "public",
        output: outputSchema,
        handler: async () => ({ ok: true }),
      },
      { admin: createFakeAdmin(), authenticate: async () => null, now: () => 0 },
    );

    const cold = await runWithRequestContext(undefined, () => GET!({ request: makeRequest() }), {
      cold: true,
    });
    const warm = await runWithRequestContext(undefined, () => GET!({ request: makeRequest() }));
    expect(cold.headers.get("server-timing")).toBe("auth;dur=0, handler;dur=0, total;dur=0, cold");
    expect(warm.headers.get("server-timing")).toBe("auth;dur=0, handler;dur=0, total;dur=0");
  });

  it("still answers when the cold check itself fails", async () => {
    process.env.API_V1_ENABLED = "true";
    const { GET } = createApiRouteHandler(
      {
        method: "GET",
        path: "/api/v1/test",
        auth: "public",
        output: outputSchema,
        handler: async () => ({ ok: true }),
      },
      {
        admin: createFakeAdmin(),
        authenticate: async () => null,
        now: () => 0,
        wasCold: async () => {
          throw new Error("no request scope");
        },
      },
    );

    const res = await GET!({ request: makeRequest() });
    expect(res.status).toBe(200);
    expect(res.headers.get("server-timing")).toBe("auth;dur=0, handler;dur=0, total;dur=0");
  });

  it("logs a slow request with its route template and phases, and nothing for a fast one", async () => {
    process.env.API_V1_ENABLED = "true";
    const clock = { t: 0 };
    let handlerMs = 3_200;
    const { GET } = createApiRouteHandler(
      {
        method: "GET",
        path: "/api/v1/athletes/{id}",
        auth: "public",
        output: outputSchema,
        handler: async () => {
          clock.t += handlerMs;
          return { ok: true };
        },
      },
      {
        admin: createFakeAdmin(),
        authenticate: async () => null,
        now: () => clock.t,
        wasCold: async () => false,
      },
    );

    const lines: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void lines.push(args);
    try {
      await GET!({ request: makeRequest() });
      handlerMs = 200;
      await GET!({ request: makeRequest() });
    } finally {
      console.warn = original;
    }

    expect(lines).toHaveLength(1);
    expect(lines[0]![0]).toBe("[api] slow request");
    expect(JSON.parse(lines[0]![1] as string)).toEqual({
      method: "GET",
      route: "/api/v1/athletes/{id}",
      status: 200,
      cold: false,
      auth: 0,
      handler: 3200,
      total: 3200,
    });
  });
});

describe("conditional GET (etag)", () => {
  const boardSchema = z.object({ slug: z.string(), generatedAt: z.string().nullable() });

  function handler(generatedAt: string | null) {
    process.env.API_V1_ENABLED = "true";
    return createApiRouteHandler(
      {
        method: "GET",
        path: "/api/v1/test",
        auth: "public",
        output: boardSchema,
        etag: (b) => (b.generatedAt ? weakETag([b.slug, b.generatedAt]) : null),
        handler: async () => ({ slug: "demo", generatedAt }),
      },
      { admin: createFakeAdmin(), authenticate: async () => null },
    ).GET!;
  }

  it("sends a weak ETag with the body", async () => {
    const res = await handler("2026-09-05T21:16:35.374Z")({ request: makeRequest() });
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('W/"demo.2026-09-05T21:16:35.374Z"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ slug: "demo", generatedAt: "2026-09-05T21:16:35.374Z" });
  });

  it("answers a matching If-None-Match with an empty 304 that repeats the ETag", async () => {
    const GET = handler("2026-09-05T21:16:35.374Z");
    const res = await GET({
      request: makeRequest({ headers: { "if-none-match": 'W/"demo.2026-09-05T21:16:35.374Z"' } }),
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe('W/"demo.2026-09-05T21:16:35.374Z"');
    expect(await res.text()).toBe("");
  });

  it("serves the body again when the validator differs or is absent", async () => {
    const GET = handler("2026-09-05T21:17:05.000Z");
    const stale = await GET({
      request: makeRequest({ headers: { "if-none-match": 'W/"demo.2026-09-05T21:16:35.374Z"' } }),
    });
    expect(stale.status).toBe(200);
    const never = await handler(null)({
      request: makeRequest({ headers: { "if-none-match": "*" } }),
    });
    expect(never.status).toBe(200);
    expect(never.headers.get("ETag")).toBeNull();
  });

  it("matches weakly, across lists, and on *", () => {
    expect(ifNoneMatchMatches('W/"a"', 'W/"a"')).toBe(true);
    expect(ifNoneMatchMatches('"a"', 'W/"a"')).toBe(true);
    expect(ifNoneMatchMatches('"x", W/"a"', 'W/"a"')).toBe(true);
    expect(ifNoneMatchMatches("*", 'W/"a"')).toBe(true);
    expect(ifNoneMatchMatches('"b"', 'W/"a"')).toBe(false);
    expect(ifNoneMatchMatches(null, 'W/"a"')).toBe(false);
    expect(weakETag(["slug", 'we"ird stamp'])).toBe('W/"slug.we_ird_stamp"');
  });
});

describe("query strings", () => {
  it("parses and coerces the query into the handler, and 400s bad values", async () => {
    process.env.API_V1_ENABLED = "true";
    const { GET } = createApiRouteHandler(
      {
        method: "GET",
        path: "/api/v1/test",
        auth: "public",
        query: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          cursor: z.string().optional(),
        }),
        output: z.object({ limit: z.number(), cursor: z.string().nullable() }),
        handler: async ({ query }) => ({ limit: query.limit, cursor: query.cursor ?? null }),
      },
      { admin: createFakeAdmin(), authenticate: async () => null },
    );
    const ok = await GET!({
      request: new Request("https://gradus.training/api/v1/test?limit=5&cursor=abc"),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ limit: 5, cursor: "abc" });

    const defaults = await GET!({ request: new Request("https://gradus.training/api/v1/test") });
    expect(await defaults.json()).toEqual({ limit: 50, cursor: null });

    const bad = await GET!({
      request: new Request("https://gradus.training/api/v1/test?limit=999"),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("validation_failed");
  });
});

describe("multipart bodies", () => {
  it("hands the handler the form fields, files as Blobs", async () => {
    process.env.API_V1_ENABLED = "true";
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/test",
        auth: "public",
        body: "multipart",
        input: z.object({
          audio: z.custom<Blob>((v) => v instanceof Blob),
          mode: z.enum(["create", "edit"]),
        }),
        output: z.object({ mode: z.string(), bytes: z.number(), type: z.string() }),
        handler: async ({ input }) => ({
          mode: input.mode,
          bytes: input.audio.size,
          type: input.audio.type,
        }),
      },
      { admin: createFakeAdmin(), authenticate: async () => null },
    );
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(1234)], { type: "audio/mp4" }), "voice.m4a");
    form.append("mode", "create");
    const response = await POST!({ request: makeRequest({ method: "POST", body: form }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    // Bun derives the part's type from the filename (audio/x-m4a); browsers keep audio/mp4.
    expect(body).toMatchObject({ mode: "create", bytes: 1234 });
    expect(body.type).toMatch(/^audio\//);
  });

  it("a JSON body on a multipart route is 400 validation_failed", async () => {
    process.env.API_V1_ENABLED = "true";
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/test",
        auth: "public",
        body: "multipart",
        input: z.object({ mode: z.string() }),
        output: z.object({ ok: z.boolean() }),
        handler: async () => ({ ok: true }),
      },
      { admin: createFakeAdmin(), authenticate: async () => null },
    );
    const response = await POST!({
      request: makeRequest({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "create" }),
      }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("validation_failed");
  });
});

describe("multipart body cap", () => {
  it("refuses an oversized upload before reading it", async () => {
    process.env.API_V1_ENABLED = "true";
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/test",
        auth: "public",
        body: "multipart",
        maxBodyBytes: 1024,
        input: z.object({ mode: z.string() }),
        output: z.object({ ok: z.boolean() }),
        handler: async () => ({ ok: true }),
      },
      { admin: createFakeAdmin(), authenticate: async () => null },
    );
    const response = await POST!({
      request: makeRequest({
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "5000000" },
        body: "ignored",
      }),
    });
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("payload_too_large");
  });
});

describe("JSON body size cap (opt-in)", () => {
  const route = (maxBodyBytes?: number) =>
    createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/test",
        auth: "public",
        maxBodyBytes,
        input: z.object({ note: z.string() }),
        output: z.object({ ok: z.boolean() }),
        handler: async () => ({ ok: true }),
      },
      { admin: createFakeAdmin(), authenticate: async () => null },
    );

  it("answers 413 when a route with maxBodyBytes gets a bigger JSON body", async () => {
    process.env.API_V1_ENABLED = "true";
    const body = JSON.stringify({ note: "x".repeat(2000) });
    const capped = await route(1024).POST!({ request: makeRequest({ method: "POST", body }) });
    expect(capped.status).toBe(413);
    expect((await capped.json()).error.code).toBe("payload_too_large");
    // Routes without the option are unchanged.
    const open = await route().POST!({ request: makeRequest({ method: "POST", body }) });
    expect(open.status).toBe(200);
  });
});
