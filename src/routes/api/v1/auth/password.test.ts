import { describe, expect, it, mock } from "bun:test";
import { createApiRouteHandler } from "@/lib/api/define-route";
import type { ApiContext } from "@/lib/api/auth";
import { passwordRouteOptions } from "./password";

/**
 * Minimal in-memory Supabase-shaped fake for `.from(table).select().eq()
 * .maybeSingle()`, `.update().eq()`, and `.upsert()` — the shapes
 * rate-limit.ts and app-attest.server.ts use. Mirrors the fake in
 * src/lib/api/define-route.test.ts. Test-only; never shipped.
 */
function createFakeAdmin() {
  const store = new Map<string, Record<string, unknown>[]>();
  function rowsFor(table: string) {
    if (!store.has(table)) store.set(table, []);
    return store.get(table)!;
  }
  function builder(table: string, filters: Array<[string, unknown]>) {
    return {
      select: (_columns?: string) => builder(table, filters),
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

/**
 * Builds the route's handler with an injected fake `admin` for the
 * route-level rate limit (`createApiRouteHandler`'s own `deps.admin`), and
 * mocks `@/integrations/supabase/client.server` with the SAME fake so the
 * handler body's own direct `supabaseAdmin` uses (the per-identifier rate
 * limit, `resolveSignInEmail`, and the App Attest check) see it too — that
 * module import is live, so this retroactive mock reaches an
 * already-loaded `password.ts` (proven in coach-resources.server.test.ts's
 * withFakeAdminStorage). Unlike testing through the file route's own
 * `Route` export, going through `passwordRouteOptions()` +
 * `createApiRouteHandler` directly sidesteps `define-route.ts`'s
 * module-level `defaultDeps` (frozen to the real client the first time
 * *any* route built via `defineApiRoute` is imported in this test run),
 * which otherwise makes the route-level rate limiter hit a real (and here,
 * fake-configured) Supabase project.
 */
async function withPasswordRoute<T>(
  admin: ApiContext["admin"],
  run: (POST: (args: { request: Request }) => Promise<Response>) => Promise<T>,
): Promise<T> {
  const real = await import("@/integrations/supabase/client.server");
  mock.module("@/integrations/supabase/client.server", () => ({ ...real, supabaseAdmin: admin }));
  try {
    const { POST } = createApiRouteHandler(passwordRouteOptions(), {
      admin,
      authenticate: async () => null,
    });
    return await run(POST!);
  } finally {
    mock.module("@/integrations/supabase/client.server", () => real);
  }
}

describe("POST /api/v1/auth/password — App Attest headers never change the response", () => {
  it("returns a byte-identical response whether the attest headers are absent, well-formed but unknown, or garbage", async () => {
    process.env.API_V1_ENABLED = "true";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "pub-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

    const admin = createFakeAdmin();
    const originalFetch = globalThis.fetch;
    // goTrueRequest hits GoTrue directly; stub it to a fixed successful grant
    // so every call below produces the same body regardless of attest headers.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ access_token: "a", refresh_token: "b", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    try {
      await withPasswordRoute(admin, async (POST) => {
        const makeRequest = (headers: Record<string, string> = {}) =>
          new Request("https://gradus.training/api/v1/auth/password", {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify({ identifier: "coach@example.com", password: "hunter2" }),
          });

        const baseline = await POST({ request: makeRequest() });
        const baselineText = await baseline.text();

        const withUnknownKey = await POST({
          request: makeRequest({
            "x-gradus-attest-key-id": "no-such-key",
            "x-gradus-attest-assertion": Buffer.from("irrelevant").toString("base64"),
          }),
        });
        const withUnknownKeyText = await withUnknownKey.text();

        const withGarbage = await POST({
          request: makeRequest({
            "x-gradus-attest-key-id": "",
            "x-gradus-attest-assertion": "%%%not base64 or cbor%%%",
          }),
        });
        const withGarbageText = await withGarbage.text();

        expect(baseline.status).toBe(200);
        expect(withUnknownKey.status).toBe(200);
        expect(withGarbage.status).toBe(200);
        expect(withUnknownKeyText).toBe(baselineText);
        expect(withGarbageText).toBe(baselineText);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns the same 401 shape on a rejected grant, attest headers or not", async () => {
    process.env.API_V1_ENABLED = "true";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "pub-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

    const admin = createFakeAdmin();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    try {
      await withPasswordRoute(admin, async (POST) => {
        const makeRequest = (headers: Record<string, string> = {}) =>
          new Request("https://gradus.training/api/v1/auth/password", {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify({ identifier: "other-coach@example.com", password: "wrong" }),
          });

        const baseline = await POST({ request: makeRequest() });
        const baselineText = await baseline.text();

        const withHeaders = await POST({
          request: makeRequest({
            "x-gradus-attest-key-id": "no-such-key",
            "x-gradus-attest-assertion": Buffer.from("irrelevant").toString("base64"),
          }),
        });
        const withHeadersText = await withHeaders.text();

        expect(baseline.status).toBe(401);
        expect(withHeaders.status).toBe(401);
        expect(withHeadersText).toBe(baselineText);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
