import { describe, expect, it } from "bun:test";
import type { ApiContext } from "./auth";
import { handoffUrl, webSessionInput, webSessionRoute } from "./web-session-route";

function ctxWith(
  generated: { hashed_token?: string } | null,
  email: string | null = "p@example.com",
) {
  const calls: unknown[] = [];
  const ctx = {
    userId: "u1",
    claims: email ? { email } : {},
    admin: {
      auth: {
        admin: {
          generateLink: async (args: unknown) => {
            calls.push(args);
            return generated
              ? { data: { properties: generated }, error: null }
              : { data: null, error: { message: "boom" } };
          },
          getUserById: async () => ({ data: { user: { email: null } }, error: null }),
        },
      },
    },
  } as unknown as ApiContext;
  return { ctx, calls };
}

const request = new Request("https://gradus.training/api/v1/auth/web-session", { method: "POST" });

async function run(ctx: ApiContext, next: "/parent/team" | "/coach/paywall" = "/parent/team") {
  return webSessionRoute().handler({ ctx, input: { next }, request, query: undefined, params: {} });
}

describe("POST /auth/web-session", () => {
  it("answers a same-origin handoff URL with the token and page in the fragment", async () => {
    const { ctx, calls } = ctxWith({ hashed_token: "hash-123" });
    const { url } = await run(ctx);
    expect(url).toBe("https://gradus.training/auth/handoff#token=hash-123&next=%2Fparent%2Fteam");
    expect(calls).toEqual([{ type: "magiclink", email: "p@example.com" }]);
    expect(new URL(url).search).toBe("");
  });

  it("only accepts allow-listed pages", () => {
    expect(webSessionInput.safeParse({ next: "/coach/paywall" }).success).toBe(true);
    expect(webSessionInput.safeParse({ next: "https://evil.example" }).success).toBe(false);
    expect(webSessionInput.safeParse({ next: "//evil.example" }).success).toBe(false);
    expect(webSessionInput.safeParse({ next: "/admin" }).success).toBe(false);
  });

  it("refuses an account without an email", async () => {
    const { ctx } = ctxWith({ hashed_token: "h" }, null);
    await expect(run(ctx)).rejects.toMatchObject({ code: "no_email", status: 422 });
  });

  it("fails closed when no token comes back", async () => {
    const { ctx } = ctxWith(null);
    await expect(run(ctx)).rejects.toMatchObject({ code: "internal", status: 500 });
  });

  it("builds the URL without a doubled slash", () => {
    expect(handoffUrl("https://x.test/", "t", "/coach/paywall")).toBe(
      "https://x.test/auth/handoff#token=t&next=%2Fcoach%2Fpaywall",
    );
  });
});
