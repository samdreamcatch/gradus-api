import { describe, expect, it } from "bun:test";
import { deleteMyAccountRoute } from "./account-routes";
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

function setup() {
  process.env.API_V1_ENABLED = "true";
  const admin = createFakeAdmin();
  const ctx: ApiContext = {
    userId: "user-1",
    supabase: {} as ApiContext["supabase"],
    admin,
    claims: { email: "dana@example.com", userMetadata: {} },
  };
  const calls: unknown[][] = [];
  const { DELETE } = createApiRouteHandler(
    deleteMyAccountRoute({
      deleteAccount: async (...args) => {
        calls.push(args);
        return { role: "coach", athletesDeleted: 0, athletesTransferred: 1 };
      },
    }),
    { admin, authenticate: async () => ctx },
  );
  const request = (body?: string) =>
    new Request("https://gradus.training/api/v1/me", {
      method: "DELETE",
      headers: { authorization: "Bearer t" },
      body,
    });
  return { DELETE: DELETE!, request, calls };
}

describe("DELETE /api/v1/me", () => {
  it("answers 422 confirm_phrase_mismatch on a wrong phrase and never reaches the delete", async () => {
    const { DELETE, request, calls } = setup();
    const res = await DELETE({ request: request(JSON.stringify({ confirmPhrase: "nope" })) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("confirm_phrase_mismatch");
    expect(body.error.message).toBe("Type DELETE ACCOUNT to confirm.");
    expect(calls).toEqual([]);
  });

  it("answers 400 validation_failed without a body", async () => {
    const { DELETE, request, calls } = setup();
    const res = await DELETE({ request: request() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation_failed");
    expect(calls).toEqual([]);
  });

  it("deletes as self with the token's email and the minor choices on a matching phrase", async () => {
    const { DELETE, request, calls } = setup();
    const choice = { athleteId: "8b1a9c2e-3f4d-4e5f-8a6b-7c8d9e0f1a2b", action: "keep" };
    const res = await DELETE({
      request: request(
        JSON.stringify({ confirmPhrase: " delete account ", minorChoices: [choice] }),
      ),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      role: "coach",
      athletesDeleted: 0,
      athletesTransferred: 1,
    });
    expect(calls).toEqual([["user-1", "dana@example.com", "self", [choice]]]);
  });
});
