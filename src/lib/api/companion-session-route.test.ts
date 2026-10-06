import { describe, expect, it } from "bun:test";
import type { ApiContext } from "./auth";
import {
  companionSessionOutput,
  companionSessionRoute,
  type CompanionSessionDeps,
} from "./companion-session-route";

function ctxWith(email: string | null = "p@example.com") {
  return {
    userId: "u1",
    claims: email ? { email } : {},
    admin: {
      auth: {
        admin: { getUserById: async () => ({ data: { user: { email: null } }, error: null }) },
      },
    },
  } as unknown as ApiContext;
}

const request = new Request("https://gradus.training/api/v1/auth/companion", { method: "POST" });

function run(ctx: ApiContext, mint?: CompanionSessionDeps["mint"]) {
  return companionSessionRoute({ mint }).handler({
    ctx,
    input: undefined,
    request,
    query: undefined,
    params: {},
  });
}

describe("POST /auth/companion", () => {
  it("mints a session for the caller's own email and returns only the three session fields", async () => {
    const minted: string[] = [];
    const out = await run(ctxWith(), async (_admin, email) => {
      minted.push(email);
      return { accessToken: "a", refreshToken: "r", expiresIn: 3600 };
    });
    expect(minted).toEqual(["p@example.com"]);
    expect(out).toEqual({ accessToken: "a", refreshToken: "r", expiresIn: 3600 });
    expect(companionSessionOutput.safeParse(out).success).toBe(true);
  });

  it("never takes the email from the request: there is no input", () => {
    const route = companionSessionRoute();
    expect(route.input).toBeUndefined();
    expect(route.auth).toBe("user");
  });

  it("is rate-limited tightly, because each call creates a session", () => {
    expect(companionSessionRoute().rateLimit).toEqual({ windowSeconds: 600, max: 5 });
  });

  it("refuses an account without an email, and mints nothing", async () => {
    let called = false;
    await expect(
      run(ctxWith(null), async () => {
        called = true;
        return { accessToken: "a", refreshToken: "r", expiresIn: 1 };
      }),
    ).rejects.toMatchObject({ code: "no_email", status: 422 });
    expect(called).toBe(false);
  });

  it("fails closed when the mint fails", async () => {
    await expect(
      run(ctxWith(), async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
