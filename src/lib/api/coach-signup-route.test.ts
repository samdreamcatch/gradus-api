import { describe, expect, it } from "bun:test";
import type { ApiContext } from "./auth";
import type { CoachSignUpResult } from "./auth-broker";
import { coachSignupRoute, provisionCoachAtSignup } from "./coach-signup-route";
import { createApiRouteHandler } from "./define-route";
import { CURRENT_TERMS_VERSION } from "../terms";

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

type Upsert = { table: string; row: Record<string, unknown>; opts: Record<string, unknown> };

/** The new coach's user-scoped client: records `terms_acceptances` upserts. */
function fakeUserContext(upserts: Upsert[], termsError: unknown = null): ApiContext {
  return {
    userId: "user-1",
    supabase: {
      from: (table: string) => ({
        async upsert(row: Record<string, unknown>, opts: Record<string, unknown>) {
          upserts.push({ table, row, opts });
          return { data: null, error: termsError };
        },
      }),
    } as unknown as ApiContext["supabase"],
    admin: createFakeAdmin(),
  };
}

const SESSION: CoachSignUpResult = {
  confirmationRequired: false,
  session: { accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 3600 },
};

function setup(
  opts: {
    signUp?: CoachSignUpResult;
    contextFor?: (token: string) => Promise<ApiContext | null>;
    ensureProfile?: (ctx: ApiContext) => Promise<unknown>;
    termsError?: unknown;
  } = {},
) {
  process.env.API_V1_ENABLED = "true";
  const upserts: Upsert[] = [];
  const calls = { signUp: 0, contextFor: [] as string[], ensureProfile: [] as string[] };
  const { POST } = createApiRouteHandler(
    coachSignupRoute({
      signUp: async () => {
        calls.signUp += 1;
        return opts.signUp ?? SESSION;
      },
      contextFor:
        opts.contextFor ??
        (async (token) => {
          calls.contextFor.push(token);
          return fakeUserContext(upserts, opts.termsError ?? null);
        }),
      ensureProfile:
        opts.ensureProfile ??
        (async (ctx) => {
          calls.ensureProfile.push(ctx.userId);
          return { id: "coach-1" };
        }),
    }),
    { admin: createFakeAdmin(), authenticate: async () => null },
  );
  const request = (ip = "203.0.113.7") =>
    new Request("https://gradus.training/api/v1/auth/signup/coach", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ email: "coach@example.com", password: "correct-horse" }),
    });
  return { POST: POST!, request, calls, upserts };
}

describe("POST /api/v1/auth/signup/coach", () => {
  it("creates the coach profile and records the current Terms before returning the session", async () => {
    const { POST, request, calls, upserts } = setup();
    const res = await POST({ request: request() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      confirmationRequired: false,
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresIn: 3600,
    });
    expect(calls.contextFor).toEqual(["access-1"]);
    expect(calls.ensureProfile).toEqual(["user-1"]);
    expect(upserts).toEqual([
      {
        table: "terms_acceptances",
        row: { user_id: "user-1", role: "coach", terms_version: CURRENT_TERMS_VERSION },
        opts: { onConflict: "user_id,terms_version", ignoreDuplicates: true },
      },
    ]);
  });

  it("provisions nothing when email confirmation is required (no session)", async () => {
    const { POST, request, calls, upserts } = setup({ signUp: { confirmationRequired: true } });
    const res = await POST({ request: request() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmationRequired: true });
    expect(calls.contextFor).toEqual([]);
    expect(calls.ensureProfile).toEqual([]);
    expect(upserts).toEqual([]);
  });

  it("still returns the session when the profile can't be created, and skips the Terms", async () => {
    const { POST, request, upserts } = setup({
      ensureProfile: async () => {
        throw new Error("db down");
      },
    });
    const res = await POST({ request: request() });
    expect(res.status).toBe(200);
    expect((await res.json()).accessToken).toBe("access-1");
    expect(upserts).toEqual([]);
  });

  it("still returns the session when the token can't be resolved", async () => {
    const { POST, request } = setup({
      contextFor: async () => {
        throw new Error("Invalid token.");
      },
    });
    const res = await POST({ request: request() });
    expect(res.status).toBe(200);
    expect((await res.json()).accessToken).toBe("access-1");
  });

  it("still returns the session when recording the Terms fails", async () => {
    const { POST, request, calls } = setup({ termsError: { message: "rls" } });
    const res = await POST({ request: request() });
    expect(res.status).toBe(200);
    expect((await res.json()).accessToken).toBe("access-1");
    expect(calls.ensureProfile).toEqual(["user-1"]);
  });
});

describe("provisionCoachAtSignup", () => {
  it("does nothing without a resolvable context", async () => {
    let ensured = false;
    await provisionCoachAtSignup("token", {
      contextFor: async () => null,
      ensureProfile: async () => {
        ensured = true;
      },
    });
    expect(ensured).toBe(false);
  });
});
